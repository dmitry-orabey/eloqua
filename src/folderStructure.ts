import { APIGatewayProxyEvent, APIGatewayProxyHandler } from "aws-lambda";

function fetchNextPages(elements: ElementResponse, url: string) {
  const pages = [];

  for (let i = 2; i < Math.floor(elements.total / 1000) + 1; i++) {
    pages.push(i);
  }

  return Promise.all(
    pages.map((pageIndex) =>
      fetch(`${url}${pageIndex}`)
        .then((resp) => resp.json())
        .then((data) => {
          if (data.Response && data.Response.elements.length !== 0) {
            return data.Response.elements as Element;
          }
          return null;
        })
        .catch(() => {
          return null;
        })
    )
  );
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
  const childFolders = await fetch(
    `${baseUrl}/${assetJSONS.apiName}/folder/${
      rootFolder.id
    }/contents?page=${1}`
  )
    .then((resp) => resp.json())
    .then((data) => {
      if (data.Response && data.Response.elements.length !== 0) {
        return data.Response as ElementResponse;
      }
      return null;
    })
    .catch(() => {
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
    ? childFolders.elements.filter((element) => element.type === "Folder")
    : null;
}

function getFolderDetails(
  folders: Element[],
  assetJSONS: AssetJSON,
  rootFolder: Element,
  endpointUrl: string
) {
  return folders.reduce((acc, element) => {
    if (element.type === "Folder") {
      acc.push({
        folderId: element.id,
        folderName: element.name,
        parentFolderId: rootFolder.id,
        absolutePath: `${endpointUrl}/${assetJSONS.apiName}/folder/${element.id}`,
        assetType: assetJSONS.assetType,
      });
    }
    return acc;
  }, [] as FolderDetail[]);
}

const recursiveAll = (array: Array<Promise<void>>) => {
  return Promise.all(array).then((result) => {
    if (result.length === array.length) return result;

    return recursiveAll(array);
  });
};

const promisesOfFolder: any[] = [];

async function fetchFolders(
  rootFolder: {
    root: Element;
    asset: AssetJSON;
  }[],
  baseUrl: string
) {
  for (const { asset, root } of rootFolder) {
    promisesOfFolder.push(
      getChildFolders(asset, root, baseUrl).then((children) => {
        if (children && children.length !== 0) {
          children.forEach((child) => {
            fetchFolders([{ root: child, asset }], baseUrl);
          });
        }

        return {
          root,
          children,
          asset,
        };
      })
    );
  }
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
        const element = await fetch(`${baseUrl}${url}${page}`)
          .then((response) => response.json())
          .then((data) => data.Response as ElementResponse);

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

    fetchFolders(rootFolders, baseUrl);

    const folders = (await recursiveAll(promisesOfFolder)) as Folder[];

    const folderDetailsArr = folders.flatMap((folder) => {
      const children = getFolderDetails(
        folder.children ? folder.children : [],
        folder.asset,
        folder.root,
        body.UrlObject.Endpoint_Url
      );

      return [...children];
    });

    const rootFolderDetailsArr = rootFolders.map<FolderDetail>(
      ({ root, asset }) => ({
        folderId: root.id,
        folderName: root.name,
        parentFolderId: null,
        absolutePath: `${body.UrlObject.Endpoint_Url}/${asset.apiName}/folder/${root.id}`,
        assetType: asset.assetType,
      })
    );

    await fetch(
      `http://apps.portqii.com:8070/saveFolder?siteId=${body.Site_Id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderDetailsArr: [...rootFolderDetailsArr, ...folderDetailsArr],
        }),
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: "Success",
      }),
    };
  } catch (e) {
    return {
      statusCode: 422,
      body: JSON.stringify({ status: e }),
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
