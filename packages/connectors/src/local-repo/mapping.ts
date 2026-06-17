import path from "node:path";

import {
  CLASSIFIER_VERSION,
  classifyRepositoryPath,
  type ClassificationResult,
} from "../classification";
import { computeContentHash } from "../content-hash";
import { DEFAULT_DOCUMENT_INDEX_STATUS } from "../document-state";

import type { LocalRepoDocumentDraft, LocalRepoFileSnapshot } from "./types";

const deriveTitleFromFilePath = (filePath: string): string => {
  const basename = path.posix.basename(filePath);
  const extension = path.posix.extname(basename);
  return extension === "" ? basename : basename.slice(0, basename.length - extension.length);
};

export const mapLocalRepoFileToDocumentDraft = (input: Readonly<{
  workspaceId: string;
  dataSourceId: string;
  file: LocalRepoFileSnapshot;
}>): LocalRepoDocumentDraft => {
  const classification: ClassificationResult = classifyRepositoryPath({
    filePath: input.file.filePath,
  });

  return {
    workspaceId: input.workspaceId,
    dataSourceId: input.dataSourceId,
    externalId: `${input.file.repoName}:${input.file.filePath}`,
    sourceType: classification.sourceType,
    title: deriveTitleFromFilePath(input.file.filePath),
    url: null,
    filePath: input.file.filePath,
    repoName: input.file.repoName,
    content: input.file.content,
    contentHash: computeContentHash(input.file.content),
    indexStatus: DEFAULT_DOCUMENT_INDEX_STATUS,
    status: classification.status,
    knowledgeTypes: classification.knowledgeTypes,
    domainTags: classification.domainTags,
    externalCreatedAt: input.file.createdAt,
    externalUpdatedAt: input.file.modifiedAt,
    metadata: {
      classifierVersion: CLASSIFIER_VERSION,
      matchedRules: classification.matchedRules,
      filePath: input.file.filePath,
      repoName: input.file.repoName,
      modifiedAt: input.file.modifiedAt.toISOString(),
    },
  };
};
