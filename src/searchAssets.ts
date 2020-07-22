import { APIGatewayProxyHandler, APIGatewayProxyEvent } from "aws-lambda";
import axios from "axios";

export const index: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
) => {
  const promises: Promise<void>[] = [];
  const body: Body = JSON.parse(event.body);
  const finalResult = [];

  const page = 0;
  const assetDetailsArr = [];

  const source = await axios
    .get<Source>(
      `http://apps.portqii.com:8070/getFolderDetails?folderId=${body.FolderDetails.folderId}&siteId=${body.SiteDetails.sourceSiteId}&assetType=${body.AssetDetails.assetType} `
    )
    // .then(({ data }) => data);
    .then(({ data }) => ({
      sourceAbsolutePath: data.Absolute_Path,
      sourceFolderName: data.Folder_Name,
    }));

  const folder = await axios
    .get<Source>(
      encodeURI(
        `http://apps.portqii.com:8070/getTargetAbsolutePath?siteId=${body.SiteDetails.targetSiteId}&assetType=${body.AssetDetails.assetType}&absolutePath=${source.sourceAbsolutePath}&sourceFolderName=${source.sourceFolderName}`
      )
    )
    .then(({ data }) => data);

  // if (true) {
  const target = {
    targetAbsolutePath: folder.Absolute_Path,
    targetFolderId: folder.Folder_Id,
  };

  const access = await axios
    .get<Access>(
      `http://apps.portqii.com:8070/getTokens?siteId=${body.SiteDetails.targetSiteId}`
    )
    .then(({ data }) => data);

  const host = `${access.Base_Url}/API/REST/2.0/assets/${
    body.AssetDetails.assetApiName
  }/folder/${target.targetFolderId}/contents?page=${page + 1}`;

  // const response = await axios
  //   .get(
  //     `https://m88a5j5z7k.executeapi.us-east-1.amazonaws.com/dev/request?access_token=${access.Access_Token}&refresh_token=${access.Refresh_Token}&client_id=${body.Authentication.ClientId}&client_secret=${body.Authentication.ClientSecret}&url=${host}`
  //   )
  //   .then(({ data }) => data);
  // }

  return {
    statusCode: 200,
    body: JSON.stringify(source),
    // body: JSON.stringify(childAssetsConfiguration),
  };
};

interface Body {
  SiteDetails: {
    sourceSiteId: number;
    targetSiteId: number;
  };
  AssetDetails: {
    assetType: string;
    assetId: number;
    assetName: string;
    assetApiName: string;
  };
  FolderDetails: {
    folderId: number;
  };
  Authentication: {
    ClientId: string;
    ClientSecret: string;
  };
}

interface Source {
  Asset_Type: string;
  Folder_Name: string;
  Folder_Id: number;
  Parent_Folder_Id: number;
  Site_Id: number;
  Absolute_Path: string;
}

interface Access {
  Base_Url: string;
  Access_Token: string;
  Refresh_Token: string;
}
