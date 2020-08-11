import { APIGatewayProxyEvent, APIGatewayProxyHandler } from "aws-lambda";
import { JSONPath } from "jsonpath-plus";
import { parse } from "node-html-parser";
import findKey from "lodash.findkey";
import find from "lodash.find";
import update from "lodash.update";

function getPath(paths: string[]) {
  return paths[0].split("$")[1];
}

function step32a(response: string, SourceLink: string, TargetLink: string) {
  return response.replace(new RegExp(SourceLink, "g"), TargetLink);
}

function step32b(
  parentAssetJSON: ParentAssetJSON,
  SourceLink: string,
  TargetLink: string
) {
  let json = JSON.stringify(parentAssetJSON);
  let sourceReplaceText = `\\"id\\":\\"${SourceLink}\\"`;
  let targetReplaceText = `\\"id\\":\\"${TargetLink}\\"`;

  json = json.split(sourceReplaceText).join(targetReplaceText);

  sourceReplaceText = `form${SourceLink}`;
  targetReplaceText = `form${TargetLink}`;
  json = json.split(sourceReplaceText).join(targetReplaceText);

  sourceReplaceText = `elqid=\\\"${SourceLink}\\\" elqtype=\\\"UserForm\\\"`;
  targetReplaceText = `elqid=\\\"${TargetLink}\\\" elqtype=\\\"UserForm\\\"`;

  json = json.split(sourceReplaceText).join(targetReplaceText);

  return JSON.parse(json);
}

function step33a(
  documentDescription: string,
  SourceLink: string,
  TargetLink: string
): string {
  const response = JSONPath({
    path: "$.rows[*].columns[*].cells[*]",
    json: JSON.parse(documentDescription),
    resultType: "value",
  });

  const obj = find(response, { type: "ImageCell" });

  if (obj && obj.content.imageUrl === SourceLink) {
    return documentDescription.replace(new RegExp(SourceLink, "g"), TargetLink);
  }
  return null;
}

function step33b(
  documentDescription: string,
  SourceLink: string,
  TargetLink: string
) {
  const response = JSONPath({
    path: "$.rows[*].columns[*].cells[*]",
    json: JSON.parse(documentDescription),
    resultType: "value",
  });

  const obj = find(response, { type: "TextCell" });

  if (obj && obj.content.hyperlink.href.includes(SourceLink)) {
    const SourceText = SourceLink.replace(new RegExp("&", "g"), "&amp;");
    const TargetText = TargetLink.replace(new RegExp("&", "g"), "&amp;");

    return documentDescription
      .replace(SourceText, TargetText)
      .replace(new RegExp(SourceLink, "g"), TargetLink);
  }

  return null;
}

function step33c(
  documentDescription: string,
  SourceLink: string,
  TargetLink: string,
  element: ReplacePath
) {
  const response = JSONPath({
    path: "$.rows[*].columns[*].cells[*]",
    json: JSON.parse(documentDescription),
    resultType: "value",
  });

  const obj = find(response, {
    type: `${element.ChildType.replace(/\s/g, "")}Cell`,
  });

  if (obj && obj.content.object.id === SourceLink) {
    return documentDescription.replace(new RegExp(SourceLink, "g"), TargetLink);
  }

  return null;
}

function step34(
  element: ReplacePath,
  response: string,
  targetLink: string,
  sourceLink: string
) {
  if (
    element.ChildType === "Signature Layout" ||
    element.ChildType === "Dynamic Content" ||
    element.ChildType === "Shared Content"
  ) {
    const root = parse(response);

    const nodes = root
      .querySelectorAll(`#${sourceLink}`)
      .filter((node) => node.getAttribute("type") === element.PlainText_Type);

    if (nodes.length) {
      nodes[0].setAttribute("id", targetLink);
      return nodes[0].toString();
    }

    return null;
  }

  return response.replace(new RegExp(sourceLink, "g"), targetLink);
}

export const index: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
) => {
  try {
    const {
      ParentAssetJSON,
      ReplacePathArr,
      SourceLink,
      TargetLink,
    }: Body = JSON.parse(event.body);

    let parentAssetJSON = ParentAssetJSON;

    ReplacePathArr.forEach((element) => {
      if (element.JSON_Path) {
        const extractedJSON = JSONPath({
          path: element.JSON_Path,
          json: ParentAssetJSON,
          resultType: "value",
        })[0];

        const path = getPath(
          JSONPath({
            path: element.JSON_Path,
            json: ParentAssetJSON,
            resultType: "path",
          })
        );

        const currentPath = ParentAssetJSON[element.Element_nodeType]
          ? `[${element.Element_nodeType}]`
          : `${path}[${element.Element_nodeType}]`;

        if (
          (ParentAssetJSON[element.Element_nodeType] ||
            findKey(ParentAssetJSON, element.Element_nodeType)) &&
          element.Element_nodeType !== "documentDescription" &&
          element.Element_nodeType !== "plainText" &&
          element.Element_nodeType !== "subject"
        ) {
          if (element.ChildType !== "Form") {
            update(parentAssetJSON, currentPath, () =>
              step32a(
                extractedJSON[element.Element_nodeType],
                SourceLink,
                TargetLink
              )
            );
          } else {
            parentAssetJSON = step32b(parentAssetJSON, SourceLink, TargetLink);
          }
        } else if (
          element.Element_nodeType &&
          element.Element_nodeType === "documentDescription"
        ) {
          // Step 3.3.a
          if (
            (element.ParentAssetType === "Email" ||
              element.ParentAssetType === "Landing Page") &&
            element.ChildType === "Image"
          ) {
            const result = step33a(
              extractedJSON[element.Element_nodeType],
              SourceLink,
              TargetLink
            );
            if (result) {
              update(parentAssetJSON, currentPath, () => result);
            }
          }
          // Step 3.3.b
          else if (
            (element.ParentAssetType === "Email" ||
              element.ParentAssetType === "Landing Page") &&
            element.ChildType === "File"
          ) {
            const result = step33b(
              extractedJSON[element.Element_nodeType],
              SourceLink,
              TargetLink
            );

            if (result) {
              update(parentAssetJSON, currentPath, () => result);
            }
          }
          // Step 3.3.c
          else if (
            element.ChildType === "Dynamic Content" ||
            element.ChildType === "Shared Content" ||
            element.ChildType === "Shared Content"
          ) {
            const result = step33c(
              extractedJSON[element.Element_nodeType],
              SourceLink,
              TargetLink,
              element
            );

            if (result) {
              update(parentAssetJSON, currentPath, () => result);
            }
          }
          // Step 3.3.d
          else {
            const documentDescription = extractedJSON[element.Element_nodeType];

            update(parentAssetJSON, currentPath, () =>
              documentDescription.replace(
                new RegExp(SourceLink, "g"),
                TargetLink
              )
            );
          }
        }
        // Step 3.4
        else if (
          element.Element_nodeType &&
          (element.Element_nodeType === "plainText" ||
            element.Element_nodeType === "subject")
        ) {
          const result = step34(
            element,
            ParentAssetJSON[element.Element_nodeType],
            TargetLink,
            SourceLink
          );

          if (result) {
            update(parentAssetJSON, currentPath, () => result);
          }
        }
      } else {
        const result = parentAssetJSON[element.Element_nodeType];
        parentAssetJSON[element.Element_nodeType] = result.replace(
          new RegExp(SourceLink, "g"),
          TargetLink
        );
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify(parentAssetJSON),
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
  ParentAssetJSON: ParentAssetJSON;
  SourceLink: string;
  TargetLink: string;
  ReplacePathArr: ReplacePath[];
}

interface ParentAssetJSON {
  type: string;
  [key: string]: string;
}

interface ReplacePath {
  ParentAssetType: string;
  ChildType: string;
  JSON_Path: string;
  Element_nodeType: string;
  PlainText_Type: string;
}
