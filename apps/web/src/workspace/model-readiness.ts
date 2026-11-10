import type { Integration } from "./types";
export type SetupStep = {
  id: string;
  label: string;
  ready: boolean;
  section: string;
};
export function modelSetupSteps(
  integration: Integration,
  {
    privateMode = false,
    mixed = false,
    agentConfigured = false,
  }: {
    privateMode?: boolean;
    mixed?: boolean;
    agentConfigured?: boolean;
  } = {},
): SetupStep[] {
  const e = integration.execution;
  const budget =
    e.settings.monthlyBudgetUsd != null &&
    Number(e.settings.monthlyBudgetUsd) > 0;
  const price = e.settings.priceVersion === e.priceVersion;
  const steps: SetupStep[] = [
    {
      id: "answer-key",
      label: "답변 Key 등록",
      ready:
        integration.credentials.answer.configured &&
        integration.credentials.answer.enabled,
      section: "model-credentials",
    },
  ];
  if (!privateMode || mixed)
    steps.push({
      id: "embedding-key",
      label: "임베딩 Key 등록",
      ready:
        integration.credentials.embedding.configured &&
        integration.credentials.embedding.enabled,
      section: "model-credentials",
    });
  steps.push(
    {
      id: "budget",
      label: "월 사용 한도 저장",
      ready: budget,
      section: "model-budget",
    },
    {
      id: "price",
      label: "가격표 확인·저장",
      ready: price,
      section: "model-budget",
    },
  );
  if (budget && price)
    steps.push({
      id: "available-budget",
      label: "사용 가능한 예산",
      ready: !e.blocked,
      section: "model-budget",
    });
  if (privateMode)
    steps.push({
      id: "attachment-transfer",
      label: "첨부 전송 허용",
      ready: integration.transfers.attachment,
      section: "model-transfers",
    });
  if (!privateMode || mixed)
    steps.push({
      id: "rag-transfer",
      label: "질문·문서 전송 허용",
      ready: integration.transfers.rag,
      section: "model-transfers",
    });
  steps.push({
    id: "agent",
    label: "기본 Agent 저장",
    ready: agentConfigured,
    section: "basic-agent-settings",
  });
  return steps;
}
export const connectionLabels: Record<
  Integration["credentials"]["answer"]["connection"],
  string
> = {
  not_checked: "미검사 (저장은 완료)",
  verified: "연결 확인됨",
  checking: "연결 검사 중",
  failed: "연결 검사 실패·미확인",
};
