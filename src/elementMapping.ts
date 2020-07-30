import { APIGatewayProxyEvent, APIGatewayProxyHandler } from "aws-lambda";

export const index: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
) => {
  try {
    const {
      sourceElementDetailsArr,
      targetElementDetailsArr,
    }: Body = JSON.parse(event.body);

    const sources = sourceElementDetailsArr.map((element) => ({
      sourceAssetType: element.SourceAssetType,
      sourceAssetId: element.SourceAssetId,
      sourceElementId: element.SourceElementId,
      sourceElementType: element.SourceElementType,
      sourceElementAssetId: element.SourceElementAssetId,
      targetAssetId: element.TargetAssetId,
      sourceConnectedElementType: element.SourceConnectedElementType,
      sourceSiteId: element.SourceSiteId,
    }));

    const targets = targetElementDetailsArr.filter((target) => {
      return sources.some(
        (source) => source.targetAssetId === target.TargetElementAssetId
      );
    });

    const elementArr = targets.reduce<ElementDetail[]>((acc, element) => {
      const source = sources.find(
        (sourceElement) =>
          element.TargetElementType === sourceElement.sourceElementType &&
          element.TargetConnectedElementType ===
            sourceElement.sourceConnectedElementType
      );

      if (source) {
        acc.push({
          sourceElementId: source.sourceElementId,
          targetElementId: element.TargetElementId,
          sourceAssetType: source.sourceAssetType,
          sourceAssetId: source.sourceAssetId,
          targetAssetId: element.TargetAssetId,
          sourceSiteId: source.sourceSiteId,
          targetSiteId: element.TargetSiteId,
        });
      }

      return acc;
    }, []);

    return {
      statusCode: 200,
      body: JSON.stringify(elementArr),
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
  sourceElementDetailsArr: SourceElementDetails[];
  targetElementDetailsArr: TargetElementDetails[];
}

interface SourceElementDetails {
  SourceAssetType: string;
  SourceAssetId: number;
  SourceElementId: number;
  SourceElementType: string;
  SourceElementAssetId: number;
  SourceConnectedElementType: string;
  TargetAssetId: number;
  SourceSiteId: number;
}

interface TargetElementDetails {
  TargetAssetType: string;
  TargetAssetId: number;
  TargetElementId: number;
  TargetElementType: string;
  TargetElementAssetId: number;
  TargetConnectedElementType: string;
  TargetSiteId: number;
}

interface ElementDetail {
  sourceElementId: number;
  targetElementId: number;
  sourceAssetType: string;
  sourceAssetId: number;
  targetAssetId: number;
  sourceSiteId: number;
  targetSiteId: number;
}
