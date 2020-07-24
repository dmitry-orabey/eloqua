import { APIGatewayProxyHandler, APIGatewayProxyEvent } from "aws-lambda";
import fetch from "node-fetch";
import { JSONPath } from "jsonpath-plus";
import update from "lodash.update";

function replaceAssetJSON(
  elements: { [key: string]: string | number }[],
  asset: DetailAssetJSON
) {
  return elements.reduce<{ [key: string]: string | number }[]>(
    (acc, element) => {
      if (
        element.type === asset.nodeType &&
        `${element[asset.nodeValue]}` === `${asset.SourceAssetId}`
      ) {
        acc.push({
          ...element,
          [asset.nodeValue]: asset.targetAssetId,
        });
      } else {
        acc.push({
          ...element,
        });
      }

      return acc;
    },
    []
  );
}

function getPath(JSONPathExpression: string[]) {
  return JSONPathExpression[0].split("$")[1].split(/\[[\d]+\]$/)[0];
}

export const index: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
) => {
  try {
    const body: Body = JSON.parse(event.body);

    const assetJSON: AssetJSON = await fetch(
      `http://apps.portqii.com:8070/getAssetJSONByExecutionId?executionId=${body.Execution_Id}`
    )
      .then((resp) => resp.json())
      .then((resp) => JSON.parse(resp[0].Asset_JSON));

    const detailsAssetJSON: DetailAssetJSONResponse[] = await fetch(
      `http://apps.portqii.com:8070/getChildDetailsByParentExecutionId?executionId=${body.Execution_Id}`
    ).then((resp) => resp.json());

    const assets = detailsAssetJSON.map<DetailAssetJSON>((detail) => ({
      assetType: detail.Asset_Type,
      SourceAssetId: detail.Asset_Id,
      targetAssetId: detail.Target_Asset_Id,
      JSONPath: detail.JSON_Path,
      nodeValue: detail.Node_Value,
      nodeType: detail.Node_Type,
    }));

    const replaceJSON = assets.reduce((acc, asset) => {
      if (asset.JSONPath) {
        const result = JSONPath({ path: asset.JSONPath, json: assetJSON });
        const path = getPath(
          JSONPath({
            path: asset.JSONPath,
            json: assetJSON,
            resultType: "path",
          })
        );
        const newJSON = { ...(acc ? { ...assetJSON, ...acc } : acc) };

        update(newJSON, path, () => replaceAssetJSON(result, asset));

        return newJSON;
      }

      const result = JSONPath({ path: asset.nodeValue, json: assetJSON });

      if (`${result[0]}` === `${asset.SourceAssetId}`) {
        return {
          ...assetJSON,
          [asset.nodeValue]: asset.targetAssetId,
        };
      }

      return acc;
    }, {});

    return {
      statusCode: 200,
      body: JSON.stringify(replaceJSON),
    };
  } catch (e) {
    return {
      statusCode: 422,
      body: JSON.stringify({
        status: "Failed",
      }),
    };
  }
};

interface Body {
  Execution_Id: string;
}

interface AssetJSON {
  type: string;

  [key: string]: string | number;
}

interface DetailAssetJSON {
  assetType: string;
  SourceAssetId: number;
  targetAssetId: number;
  JSONPath: string;
  nodeValue: string;
  nodeType: string;
}

interface DetailAssetJSONResponse {
  Sync_Execution_Id: number;
  Sync_History_Id: number;
  Asset_Type: string;
  Asset_Id: number;
  Asset_Name: string;
  Parent_Execution_Id: number;
  Asset_JSON: null | string;
  JSON_Path: string;
  Node_Value: string;
  Node_Type: string;
  Missing_Target_Flag: null | string;
  Duplicate_Flag: null | string;
  Target_Asset_Id: number;
  Target_Asset_Name: null | string;
  Target_Asset_JSON: null | string;
}
