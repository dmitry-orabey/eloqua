import { APIGatewayProxyEvent, APIGatewayProxyHandler } from "aws-lambda";
import axios from "axios";
import axiosRetry from "axios-retry";

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => {
    return retryCount * 1000;
  },
});

function getPath(
  folders: Array<Omit<FolderDetail, "absolutePath">>,
  parentFolderId: string,
  path: string
): string {
  const folder = folders.find(({ folderId }) => folderId === parentFolderId);

  if (folder) {
    return `${getPath(
      folders,
      folder.parentFolderId,
      folder.folderName
    )}/${path}`;
  }
  return path;
}

function fetchNextPages(elements: ElementResponse, url: string) {
  const pages = [];

  for (let i = 2; i < Math.floor(elements.total / 1000) + 1; i++) {
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
  ).catch((e) => {
    throw {
      status: e.response.status,
      message: e.message,
      url: e.response.config.url,
    };

    return null;
  });
}

function getRootFolder(elementResponse: ElementResponse) {
  return elementResponse.elements.find(
    (el) => el.isSystem === "true" && el.type === "Folder" && !el.folderId
  );
}

async function getChildFolders(
  assetJSONS: AssetJSON,
  rootFolder: Element,
  baseUrl: string
) {
  const childFolders = await axios
    .get<{ Response: ElementResponse } | null>(
      `${baseUrl}/${assetJSONS.apiName}/folder/${
        rootFolder.id
      }/contents?page=${1}`
    )
    .then(({ data }) => {
      if (data.Response && data.Response.elements.length !== 0) {
        return data.Response;
      }
      return null;
    })
    .catch((e) => {
      const error = {
        status: e.response.status,
        message: e.message,
        url: e.response.config.url,
      };
      console.log("error");

      throw e;

      return null;
    });

  if (childFolders && childFolders.total >= 1001) {
    const nextPage = await fetchNextPages(
      childFolders,
      `${baseUrl}/${assetJSONS.apiName}/folder/${rootFolder.id}/contents?page=`
    );

    childFolders.elements.push(...nextPage);
  }

  return childFolders !== null
    ? childFolders.elements.filter((element) => element?.type === "Folder")
    : null;
}

function getFolderDetails(
  folders: Element[],
  assetJSONS: AssetJSON,
  rootFolder: Element
) {
  return folders.reduce<Array<Omit<FolderDetail, "absolutePath">>>(
    (acc, element) => {
      if (element?.type === "Folder") {
        acc.push({
          folderId: element.id,
          folderName: element.name,
          parentFolderId: rootFolder.id,
          assetType: assetJSONS.assetType,
        });
      }
      return acc;
    },
    []
  );
}

function recursiveAll<T>(array: Array<Promise<T>>) {
  return Promise.all(array).then((result) => {
    if (result.length === array.length) return result;

    return recursiveAll(array);
  });
}

function fetchFolders(
  rootFolder: {
    root: Element;
    asset: AssetJSON;
  }[],
  baseUrl: string,
  promisesOfFolder: Promise<Folder>[]
) {
  for (const { asset, root } of rootFolder) {
    promisesOfFolder.push(
      getChildFolders(asset, root, baseUrl)
        .then((children) => {
          if (children && children.length !== 0) {
            children.forEach((child) => {
              fetchFolders([{ root: child, asset }], baseUrl, promisesOfFolder);
            });
          }

          return {
            root,
            children,
            asset,
          };
        })
        .catch((e) => {
          console.log("error2");
          throw e;
          return null;
        })
    );
  }

  return promisesOfFolder;
}

export const index: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
) => {
  try {
    const body: Body = JSON.parse(event.body);
    const page = 1;
    const baseUrl = `https://m88a5j5z7k.execute-api.us-east-1.amazonaws.com/dev/request?access_token=${body.Authorization.Access_Token}&refresh_token=${body.Authorization.Refresh_Token}&client_id=${body.Authorization.Client_Id}&client_secret=${body.Authorization.Client_Secret}&url=${body.UrlObject.Base_Ur}${body.UrlObject.Endpoint_Url}`;

    const urls = body.Asset_Type_Obj.map((asset) => ({
      asset,
      url: `/${asset.apiName}/folders?page=`,
    }));

    const elementResponses = await Promise.all<{
      element: ElementResponse;
      asset: AssetJSON;
    }>(
      urls.map(async ({ asset, url }) => {
        const element = await axios
          .get(`${baseUrl}${url}${page}`)
          .then(({ data }) => data.Response as ElementResponse)
          .catch((e) => {
            throw {
              status: e.response.status,
              message: e.message,
              url: e.response.config.url,
            };

            return null;
          });

        if (element && element.total >= 1001) {
          const nextPages = await fetchNextPages(element, `${baseUrl}${url}`);
          element.elements.push(...nextPages);
        }

        return { element, asset };
      })
    );

    const rootFolders = elementResponses.reduce((root, { asset, element }) => {
      if (element) {
        root.push({ root: getRootFolder(element), asset });
      }

      return root;
    }, [] as { root: Element; asset: AssetJSON }[]);

    const folders = (await recursiveAll(
      fetchFolders(rootFolders, baseUrl, [])
    ).catch((e) => {
      throw e;
    })) as Folder[];

    const folderDetailsArr: FolderDetail[] = folders
      .flatMap((folder) => {
        const children = getFolderDetails(
          folder.children ? folder.children : [],
          folder.asset,
          folder.root
        );

        return [...children];
      })
      .map((folder, _, array) => ({
        ...folder,
        absolutePath: `root/${getPath(
          array,
          folder.parentFolderId,
          folder.folderName
        )}`,
      }));

    const rootFolderDetailsArr = rootFolders.map<FolderDetail>(
      ({ root, asset }) => ({
        folderId: root.id,
        folderName: root.name,
        parentFolderId: null,
        absolutePath: `root`,
        assetType: asset.assetType,
      })
    );

    // await fetch(
    //   `http://apps.portqii.com:8070/saveFolder?siteId=${body.Site_Id}`,
    //   {
    //     method: "POST",
    //     headers: { "Content-Type": "application/json" },
    //     body: JSON.stringify({
    //       folderDetailsArr: [...rootFolderDetailsArr, ...folderDetailsArr],
    //     }),
    //   }
    // );

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: "Success",
        folderDetailsArr: [...rootFolderDetailsArr, ...folderDetailsArr].length,
      }),
    };
  } catch (e) {
    return {
      statusCode: 422,
      body: JSON.stringify(e),
    };
  }
};

interface Body {
  Site_Id: string;
  Asset_Type_Obj: AssetJSON[];
  UrlObject: UrlObject;
  Authorization: Authorization;
}

interface AssetJSON {
  assetType: string;
  apiName: string;
}

interface UrlObject {
  Base_Ur: string;
  Endpoint_Url: string;
}

interface Authorization {
  Access_Token: string;
  Refresh_Token: string;
  Client_Id: string;
  Client_Secret: string;
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

interface FolderDetail {
  folderId: string;
  folderName: string;
  parentFolderId: string | null;
  assetType: string;
  absolutePath: string;
}

interface Folder {
  root: Element;
  children: Element[];
  asset: AssetJSON;
}
