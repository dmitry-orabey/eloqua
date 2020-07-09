import { APIGatewayProxyHandler, APIGatewayProxyEvent } from "aws-lambda";
import fetch, { Response } from "node-fetch";
import { JSONPath } from "jsonpath-plus";
import { parse } from "node-html-parser";

function getHtmlByAssetType(assetType: string, assetJSON: AssetJSON) {
  switch (assetType) {
    case "LandingPage":
      return assetJSON.htmlContent.html || assetJSON.htmlContent.htmlBody;
      break;
    case "SharedContent":
      return assetJSON.contentHtml.html || assetJSON.contentHtml.htmlBody;
      break;
    case "EmailHeader":
    case "EmailFooter":
      return assetJSON.body;
      break;
    case "DynamicContent":
      return (
        assetJSON.defaultContentSection?.contentHtml?.html ||
        assetJSON.defaultContentSection?.contentHtml.htmlBody
      );
      break;
    default:
      return null;
      break;
  }
}

function findNode(object: Record<string, any>, key: string) {
  let value: string;
  Object.keys(object).some((k: string) => {
    if (k === key) {
      value = object[k];
      return true;
    }
    if (object[k] && typeof object[k] === "object") {
      value = findNode(object[k], key);
      return value !== undefined;
    }
    return false;
  });
  return value;
}

function getAssetsIdByJSONPath(
  json: AssetJSON | Array<any>,
  expression: string,
  nodeValue: string
) {
  const assetsId = [];
  const assets = JSONPath({ path: expression, json });
  assets.forEach((el: Node | string) => {
    if (typeof el === "string" || typeof el === "number") {
      assetsId.push(el);
    } else if (typeof el === "object") {
      // console.log(el, nodeValue);
      if (el.id && findNode(el, nodeValue))
        assetsId.push(findNode(el, nodeValue));
    }
  });
  return assetsId;
}

export const index: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
) => {
  const promises: Promise<void>[] = [];
  const body: Body = JSON.parse(event.body);
  const finalResult = [];

  const response = await fetch(
    `http://apps.portqii.com:8070/getChilAssetConfigurationsByAssetType?AssetType=${body.assetType}`
  );
  const childAssetsConfiguration: childAssetsConfiguration[] = await response.json();
  // console.log(childAssetsConfiguration);

  for (const item of childAssetsConfiguration) {
    item.JSON_Node_Value = item.JSON_Node_Value.trim();
    let childAssetIdArray = [];
    if (item.JSON_Node_Type_In_Parent === 0) {
      if (body.assetType === "Form" && !item.JSONPath_Expression) {
        childAssetIdArray = getAssetsIdByJSONPath(
          [...body.assetJSON.elements, ...body.assetJSON.processingSteps],
          `$..${item.JSON_Node_Value}`,
          item.JSON_Node_Value
        );
        // console.log(item.JSON_Node_Value, childAssetIdArray);
      } else if (item.JSONPath_Expression) {
        childAssetIdArray = getAssetsIdByJSONPath(
          body.assetJSON,
          item.JSONPath_Expression,
          item.JSON_Node_Value
        );
      } else {
        childAssetIdArray = getAssetsIdByJSONPath(
          body.assetJSON,
          `$..${item.JSON_Node_Value}`,
          item.JSON_Node_Value
        );
      }
    } else {
      childAssetIdArray = getAssetsIdByJSONPath(
        body.assetJSON,
        item.JSONPath_Expression || item.JSON_Node_Value,
        item.JSON_Node_Value
      );
    }

    // console.log(
    //   item.JSON_Node_Type_In_Parent
    //     ? item.JSONPath_Expression || item.JSON_Node_Value
    //     : `$..${item.JSON_Node_Value}`,
    //   getAssetsIdByJSONPath(
    //     body.assetJSON,
    //     item.JSON_Node_Type_In_Parent
    //       ? item.JSONPath_Expression || item.JSON_Node_Value
    //       : `$..${item.JSON_Node_Value}`,
    //     item.JSON_Node_Value
    //   )
    // );

    if (childAssetIdArray.length) {
      promises.push(
        fetch(`
        http://apps.portqii.com:8070/getChildAssetEndPointsByJSON_Node_TypeAndJSON_Node_Value?JSON_Node_Value=${item.JSON_Node_Value}&JSON_Node_Type=${item.JSON_Node_Type}
      `).then(async (r: Response) => {
          const endpoints: Endpoint[] = await r.json();
          if (endpoints.length) {
            const result = await (
              await fetch(
                `http://apps.portqii.com:8070/getAssetTypeByEndpointUrl?Endpoint_URL=${encodeURIComponent(
                  endpoints[0].Endpoint_URL
                )}&JSON_Node_Value=${item.JSON_Node_Value}`
              )
            ).json();
            const assetData = result[0];
            if (assetData) {
              childAssetIdArray.forEach((childAsset) => {
                finalResult.push({
                  childAssetType: assetData.Asset_Type,
                  childAssetId: childAsset,
                  nodeValue: item.JSON_Node_Value,
                  jsonPath: item.JSONPath_Expression,
                });
              });
            }
          }
        })
      );
    }
  }
  await Promise.all(promises);

  const trimmedAssetType = body.assetType.replace(" ", "");

  if (
    trimmedAssetType === "LandingPage" ||
    trimmedAssetType === "SharedContent" ||
    trimmedAssetType === "DynamicContent" ||
    trimmedAssetType === "EmailFooter" ||
    trimmedAssetType === "EmailHeader"
  ) {
    const data = getHtmlByAssetType(trimmedAssetType, body.assetJSON);
    if (data) {
      const doc = parse(data);
      const result = doc.querySelectorAll(".eloquaemail");
      result.forEach((item) => {
        finalResult.push({
          childAssetType: "Field Merge",
          childAssetName: item.innerHTML,
          nodeValue: "id",
          jsonPath: "",
        });
      });
    }
  }

  if (body.assetType === "Email" || body.assetType === "email") {
    const doc = parse(body.assetJSON.plainText);
    const result = doc.querySelectorAll("[layoutid]");
    result.forEach((item) => {
      finalResult.push({
        childAssetType: "Signature Layout",
        childAssetId: item.getAttribute("layoutid"),
        nodeValue: "email_signatureLayout",
        jsonPath: "",
      });
    });
  }

  return {
    statusCode: 200,
    body: JSON.stringify(finalResult),
    // body: JSON.stringify(childAssetsConfiguration),
  };
};

interface Endpoint {
  Endpoint_URL: string;
  Depth: string;
}

interface Body {
  assetType: string;
  assetJSON: AssetJSON;
}

interface AssetJSON {
  elements: [];
  processingSteps: [];
  htmlContent: {
    html: string;
    htmlBody: string;
  };
  contentHtml: {
    html: string;
    htmlBody: string;
  };
  defaultContentSection: {
    contentHtml: {
      html: string;
      htmlBody: string;
    };
  };
  body: string;
  plainText: string;
}

interface childAssetsConfiguration {
  JSON_Node_Type_In_Parent: number;
  JSONPath_Expression: string;
  JSON_Node_Value: string;
  JSON_Node_Type: string;
}

interface Node {
  id: string;
}
