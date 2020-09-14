import { APIGatewayProxyHandler, APIGatewayProxyEvent } from "aws-lambda";
import { JSONPath } from "jsonpath-plus";
import update from "lodash.update";

function replaceAssetJSON(
  elements: { [key: string]: string | number }[],
  asset: DetailAssetJSON
) {
  return elements.map((element) => {
    if (
      element.type === asset.nodeType &&
      `${element[asset.nodeValue]}` === `${asset.childAssetId}`
    ) {
      return {
        ...element,
        [asset.nodeValue]: asset.targetChildAssetId,
      };
    }

    return {
      ...element,
    };
  });
}

export const index: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
) => {
  try {
    const body: Body = JSON.parse(event.body);

    const assetJSON = body.parentAssetJSON;
    const assets = body.childAssetDetailsArr;

    const replaceJSON = assets.reduce(
      (acc, asset) => {
        if (asset.jsonPath) {
          const paths: string[] = JSONPath({
            path: asset.jsonPath,
            json: acc,
            resultType: "path",
          });

          paths.forEach((path) => {
            update(acc, path.split("$")[1], () => {
              const initialJSON = JSONPath({
                path,
                json: acc,
                resultType: "value",
              });

              const modifiedJSON = replaceAssetJSON(initialJSON, asset);

              return modifiedJSON.reduce(
                (_, element) => ({
                  ...element,
                }),
                {}
              );
            });
          });

          return acc;
        }

        const result = JSONPath({ path: asset.nodeValue, json: acc });

        if (`${result[0]}` === `${asset.childAssetId}`) {
          return {
            ...acc,
            [asset.nodeValue]: asset.targetChildAssetId,
          };
        }

        if (assetJSON.type === "Campaign") {
          return {
            ...acc,
            connectedId: asset.targetChildAssetId,
          };
        }

        return acc;
      },
      { ...assetJSON }
    );

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
  parentAssetJSON: AssetJSON;
  childAssetDetailsArr: DetailAssetJSON[];
}

interface AssetJSON {
  type: string;
  [key: string]: string | number;
}

interface DetailAssetJSON {
  childAssetType: string;
  childAssetId: number;
  targetChildAssetId: number;
  jsonPath: string;
  nodeValue: string;
  nodeType: string;
}
