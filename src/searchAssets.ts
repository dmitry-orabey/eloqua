import { APIGatewayProxyEvent, APIGatewayProxyHandler } from "aws-lambda";
import axios from "axios";

function getAssetDetailsJSON(filter_arr: Element[], assetType: string) {
  if (filter_arr.length === 1) {
    return {
      assetType,
      assetName: filter_arr[0].name,
      assetId: filter_arr[0].id,
      missingAssetInTarget: 0,
      duplicateFlag: 0,
      missingFolderInTarget: 0,
      assetUpdatedAt: filter_arr[0].updatedAt,
    };
  }
  if (filter_arr.length === 0) {
    return {
      assetType,
      assetName: "",
      assetId: "",
      missingAssetInTarget: 1,
      duplicateFlag: 0,
      missingFolderInTarget: 0,
      assetUpdatedAt: "",
    };
  }
  if (filter_arr.length > 1) {
    return {
      assetType,
      assetName: filter_arr[0].name,
      assetId: filter_arr[0].id,
      missingAssetInTarget: 0,
      duplicateFlag: 1,
      missingFolderInTarget: 0,
      assetUpdatedAt: filter_arr[0].updatedAt,
    };
  }

  return null;
}

function fetchNextPages(elements: ElementResponse, url: string) {
  const pages = [];

  for (let i = 2; i < Math.ceil(elements.total / 1000) + 1; i++) {
    pages.push(i);
  }

  return Promise.all(
    pages.map((pageIndex) =>
      axios.get(`${url}${pageIndex}`).then(({ data }) => {
        if (data.Response && data.Response.elements.length !== 0) {
          return data.Response.elements as Element;
        }
        return null;
      })
    )
  )
    .then((data) => data.flat())
    .catch((e) => {
      throw {
        status: e.response.status,
        message: e.message,
        url: e.response.config.url,
      };
    });
}

async function refreshTokens(
  access: Access,
  targetSiteId: number,
  url: string,
  page: number
): Promise<ElementResponse> {
  await axios
    .get(
      `http://apps.portqii.com:8070/updateToken?AccessToken=${encodeURIComponent(
        access.Access_Token
      )}&RefreshToken=${encodeURIComponent(
        access.Refresh_Token
      )}&siteId=${targetSiteId}`
    )
    .then(({ data }) => data);

  return axios
    .get<Response>(`${url}${page + 1}`)
    .then(({ data }) => data.Response)
    .catch(() => null);
}

export const index: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
) => {
  try {
    const body: Body = JSON.parse(event.body);

    const page = 0;
    const assetDetailsArr = [];

    const source = await axios
      .get<Source>(
        `http://apps.portqii.com:8070/getFolderDetails?folderId=${body.FolderDetails.folderId}&siteId=${body.SiteDetails.sourceSiteId}&assetType=${body.AssetDetails.assetType} `
      )
      .then(({ data }) => ({
        sourceAbsolutePath: data.Absolute_Path,
        sourceFolderName: data.Folder_Name,
      }))
      .catch((e) => {
        throw {
          status: e.response.status,
          message: e.message,
          url: e.response.config.url,
        };
      });

    const folder = await axios
      .get<Source>(
        encodeURI(
          `http://apps.portqii.com:8070/getTargetAbsolutePath?siteId=${body.SiteDetails.targetSiteId}&assetType=${body.AssetDetails.assetType}&absolutePath=${source.sourceAbsolutePath}&sourceFolderName=${source.sourceFolderName}`
        )
      )
      .then(({ data }) => data);

    if (folder) {
      const target = {
        targetAbsolutePath: folder.Absolute_Path,
        targetFolderId: folder.Folder_Id,
      };

      const access = await axios
        .get<Access>(
          `http://apps.portqii.com:8070/getTokens?siteId=${body.SiteDetails.targetSiteId}`
        )
        .then(({ data }) => data)
        .catch((e) => {
          throw {
            status: e.response.status,
            message: e.message,
            url: e.response.config.url,
          };
        });

      const host = `${access.Base_Url}/API/REST/2.0/assets/${body.AssetDetails.assetApiName}/folder/${target.targetFolderId}/contents?page=`;
      const url = `https://m88a5j5z7k.execute-api.us-east-1.amazonaws.com/dev/request?access_token=${encodeURIComponent(
        access.Access_Token
      )}&refresh_token=${encodeURIComponent(access.Refresh_Token)}&client_id=${
        body.Authentication.ClientId
      }&client_secret=${body.Authentication.ClientSecret}&url=${host}`;

      let elementResponse = await axios
        .get<Response>(`${url}${page + 1}`)
        .then(({ data }) => data.Response)
        .catch<null>(() => null);

      if (!elementResponse) {
        elementResponse = await refreshTokens(
          access,
          body.SiteDetails.targetSiteId,
          url,
          page
        );
      }

      if (elementResponse && elementResponse.total >= 1001) {
        const nextPage = await fetchNextPages(elementResponse, url);

        elementResponse.elements.push(...nextPage);
      }

      if (elementResponse) {
        const filter_arr = elementResponse.elements.filter(
          (element) =>
            element.type === body.AssetDetails.assetSearchName &&
            element.name === body.AssetDetails.assetName
        );

        const assetDetailsJSON = getAssetDetailsJSON(
          filter_arr,
          body.AssetDetails.assetType
        );

        if (assetDetailsJSON) {
          assetDetailsArr.push(assetDetailsJSON);
        }
      } else {
        const assetDetailsJSON = {
          assetType: body.AssetDetails.assetType,
          assetName: "",
          assetId: "",
          missingAssetInTarget: 1,
          duplicateFlag: 0,
          missingFolderInTarget: 1,
        };

        assetDetailsArr.push(assetDetailsJSON);
      }
    } else {
      const assetDetailsJSON = {
        assetType: body.AssetDetails.assetType,
        assetName: "",
        assetId: "",
        targetFolderId: "",
        missingFolderStructure: 1,
      };

      assetDetailsArr.push(assetDetailsJSON);
    }

    return {
      statusCode: 200,
      body: JSON.stringify(assetDetailsArr),
    };
  } catch (e) {
    return {
      statusCode: e.status || 422,
      body: JSON.stringify(e),
    };
  }
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
    assetSearchName: string;
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

interface Response {
  ResponseCode: number;
  ErrorDescription: string;
  Response: ElementResponse;
}

interface ElementResponse {
  elements: Element[];
  page: number;
  pageSize: number;
  total: number;
}

interface Element {
  type: string;
  id: string;
  createdAt: string;
  depth: string;
  description: string;
  name: string;
  updatedAt: string;
  updatedBy: string;
  archive: string;
  isSystem: string;
  folderId?: string;
}
