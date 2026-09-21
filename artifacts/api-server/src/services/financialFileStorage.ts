import { randomUUID } from "node:crypto";
import type { File } from "@google-cloud/storage";
import { Storage } from "@google-cloud/storage";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateDirectory() {
  const value = process.env.PRIVATE_OBJECT_DIR;
  if (!value) throw new Error("PRIVATE_OBJECT_DIR is niet ingesteld.");
  return value.replace(/\/+$/, "");
}

function parseStoragePath(path: string) {
  const parts = path.replace(/^\/+/, "").split("/");
  if (parts.length < 2) throw new Error("Ongeldig objectpad.");
  return { bucket: parts[0], object: parts.slice(1).join("/") };
}

function fileForObjectPath(objectPath: string): File {
  if (!/^\/objects\/financial-submissions\/\d+\/\d+\/[a-f0-9-]+\.xlsx$/.test(objectPath)) {
    throw new Error("Ongeldig objectpad.");
  }
  const relativePath = objectPath.slice("/objects/".length);
  const location = parseStoragePath(`${privateDirectory()}/${relativePath}`);
  return storage.bucket(location.bucket).file(location.object);
}

async function signedPutUrl(bucket: string, object: string) {
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucket,
      object_name: object,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Objectopslag gaf status ${response.status}.`);
  const body = await response.json() as { signed_url?: unknown };
  if (typeof body.signed_url !== "string") throw new Error("Objectopslag gaf geen upload-URL.");
  return body.signed_url;
}

export type FinancialSubmissionStorage = {
  requestUpload(participantId: number, seasonId: number): Promise<{ uploadUrl: string; objectPath: string }>;
  listFinancialSubmissionObjects(): Promise<Array<{ objectPath: string; createdAt: Date | null }>>;
  inspect(objectPath: string): Promise<{ size: number; contentType: string | null; hasZipSignature: boolean } | null>;
  createReadStream(objectPath: string): NodeJS.ReadableStream;
  delete(objectPath: string): Promise<void>;
};

export const financialSubmissionStorage: FinancialSubmissionStorage = {
  async requestUpload(participantId, seasonId) {
    const relativePath = `financial-submissions/${participantId}/${seasonId}/${randomUUID()}.xlsx`;
    const location = parseStoragePath(`${privateDirectory()}/${relativePath}`);
    return {
      uploadUrl: await signedPutUrl(location.bucket, location.object),
      objectPath: `/objects/${relativePath}`,
    };
  },
  async listFinancialSubmissionObjects() {
    const location = parseStoragePath(`${privateDirectory()}/financial-submissions`);
    const prefix = `${location.object}/`;
    const [files] = await storage.bucket(location.bucket).getFiles({
      prefix,
    });
    return files
      .flatMap(file => {
        const relativeName = file.name.startsWith(prefix) ? file.name.slice(prefix.length) : "";
        if (!/^\d+\/\d+\/[a-f0-9-]+\.xlsx$/.test(relativeName)) return [];
        const rawCreatedAt = file.metadata.timeCreated;
        const createdAt = typeof rawCreatedAt === "string" ? new Date(rawCreatedAt) : null;
        return [{
          objectPath: `/objects/financial-submissions/${relativeName}`,
          createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
        }];
      });
  },
  async inspect(objectPath) {
    const file = fileForObjectPath(objectPath);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    const [header] = await file.download({ start: 0, end: 3 });
    return {
      size: Number(metadata.size),
      contentType: typeof metadata.contentType === "string" ? metadata.contentType : null,
      hasZipSignature: header.length >= 4
        && header[0] === 0x50
        && header[1] === 0x4b
        && ((header[2] === 0x03 && header[3] === 0x04)
          || (header[2] === 0x05 && header[3] === 0x06)
          || (header[2] === 0x07 && header[3] === 0x08)),
    };
  },
  createReadStream(objectPath) {
    return fileForObjectPath(objectPath).createReadStream();
  },
  async delete(objectPath) {
    await fileForObjectPath(objectPath).delete({ ignoreNotFound: true });
  },
};

export { XLSX_CONTENT_TYPE };