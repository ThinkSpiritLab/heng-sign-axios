import { AxiosRequestConfig, Method } from "axios";

enum PUBLIC_HEADERS_TYPE {
    host = "host",
    content_type = "content-type",
    accesskey = "x-heng-accesskey",
    nonce = "x-heng-nonce",
    signature = "x-heng-signature",
    timestamp = "x-heng-timestamp",
}

export interface S_AxiosRequestConfig extends AxiosRequestConfig {
    ak: string;
    sk: string;
    method: Method;
    url: string;
    params?: string | Record<string, string>;
    data?: string | Object;
}

export interface SignParam {
    method: string;
    host: string;
    path: string;
    query?: string | Object;
    data?: string | Object;
    content_type: string;
    ak: string;
    sk: string;
    nonce: string;
    timestamp: string;
}

export interface EncryptParam {
    algorithm: "SHA256" | "HmacSHA256";
    data: string;
    key?: string;
}

export interface EncryptFunction {
    (param: EncryptParam): string;
}

/**
 * @param dict dict: string -> (string | string[])
 * @returns
 */
function toLowerCaseSortJoin(dict: any) {
    if (typeof dict !== "object") {
        throw new Error("Given dict is not Object");
    }
    const kvArray: [string, string][] = [];
    for (const key in dict) {
        kvArray.push([
            encodeURIComponent(key.toLowerCase()),
            encodeURIComponent((getVal(dict, key) ?? "").toLowerCase()),
        ]);
    }
    kvArray.sort((a, b) => {
        if (a[0] == b[0]) {
            return a[1] < b[1] ? -1 : 1;
        } else {
            return a[0] < b[0] ? -1 : 1;
        }
    });
    const dictString = kvArray
        .map((kv) => {
            return `${kv[0]}=${kv[1]}`;
        })
        .join("&");
    return dictString;
}

/**
 * @param dict dict: string -> (string | string[])
 * @param key string
 * @returns
 */
function getVal(dict: any, key: string): string | null {
    const val = dict[key];
    if (val === undefined) {
        return null;
    } else if (val instanceof Array) {
        if (val.length && typeof val[val.length - 1] === "string") {
            return val[val.length - 1];
        }
    } else if (typeof val === "string") {
        return val;
    }
    return null;
}

export class Sign {
    private readonly encrypt: EncryptFunction;

    constructor(encrypt: EncryptFunction) {
        this.encrypt = encrypt;
    }

    generateSign({
        method,
        host,
        path,
        query,
        data,
        content_type,
        ak,
        sk,
        nonce,
        timestamp,
    }: SignParam): string {
        const METHOD = method.toUpperCase();

        let queryStrings = "";
        if (typeof query === "string") {
            queryStrings = query;
        } else {
            queryStrings = toLowerCaseSortJoin(query);
        }

        const header: Record<string, string> = {};
        header[PUBLIC_HEADERS_TYPE.host] = host;
        header[PUBLIC_HEADERS_TYPE.content_type] = content_type;
        header[PUBLIC_HEADERS_TYPE.accesskey] = ak;
        header[PUBLIC_HEADERS_TYPE.nonce] = nonce;
        header[PUBLIC_HEADERS_TYPE.timestamp] = timestamp;

        const signedHeaders = toLowerCaseSortJoin(header);

        let bodyHash = "";
        if (data === undefined || typeof data === "string") {
            bodyHash = this.encrypt({
                algorithm: "SHA256",
                data: data ?? "{}",
            });
        } else {
            bodyHash = this.encrypt({
                algorithm: "SHA256",
                data: JSON.stringify(data),
            });
        }

        const requestString = `${METHOD}\n${path}\n${queryStrings}\n${signedHeaders}\n${bodyHash}\n`;

        const sign = this.encrypt({
            algorithm: "HmacSHA256",
            key: sk,
            data: requestString,
        });
        return sign;
    }

    sign(config: S_AxiosRequestConfig): AxiosRequestConfig {
        let { url } = config;

        if (!url.startsWith("http")) {
            url += config.baseURL;
        }

        const host = url
            .replace(new RegExp("(.*://)?([^/]+)(.*)"), "$2")
            .toLowerCase();

        if (!host) {
            throw new Error("URL format error, host missing");
        }

        let path = url.replace(new RegExp("(.*://)?([^/]+)(.*)"), "$3");
        if (!path) path = "/";

        let content_type: string;
        if (config.method.toUpperCase() === "GET") {
            content_type = "";
        } else {
            content_type = "application/json;charset=utf-8";
        }

        const nonce: string = Math.random().toString();
        const timestamp: string = Math.floor(Date.now() / 1000).toString();

        const signature = this.generateSign({
            method: config.method,
            host,
            path,
            query: config.params,
            data: config.data,
            content_type,
            ak: config.ak,
            sk: config.sk,
            nonce,
            timestamp,
        });

        if (config.headers === undefined) {
            config.headers = {};
        }
        config.headers[PUBLIC_HEADERS_TYPE.accesskey] = config.ak;
        config.headers[PUBLIC_HEADERS_TYPE.content_type] = content_type;
        config.headers[PUBLIC_HEADERS_TYPE.nonce] = nonce;
        config.headers[PUBLIC_HEADERS_TYPE.timestamp] = timestamp;
        config.headers[PUBLIC_HEADERS_TYPE.signature] = signature;

        config.ak = "";
        config.sk = "";

        return config;
    }
}