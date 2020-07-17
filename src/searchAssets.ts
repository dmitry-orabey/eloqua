import { APIGatewayProxyHandler, APIGatewayProxyEvent } from "aws-lambda";

export const index: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
) => {
  const promises: Promise<void>[] = [];
  const body: Body = JSON.parse(event.body);
  const finalResult = [];

  return {
    statusCode: 200,
    body: JSON.stringify(finalResult),
    // body: JSON.stringify(childAssetsConfiguration),
  };
};
