import { APIGatewayProxyHandler } from "aws-lambda";

export const index: APIGatewayProxyHandler = async () => {
  // const promises: Promise<void>[] = [];
  // const body: Body = JSON.parse(event.body);
  const finalResult = [];

  return {
    statusCode: 200,
    body: JSON.stringify(finalResult),
    // body: JSON.stringify(childAssetsConfiguration),
  };
};
