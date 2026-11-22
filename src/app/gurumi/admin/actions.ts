"use server";

import {
  createGurumiAdminSession,
  deleteGurumiAdminSession,
  isGurumiAdminAuthenticated,
  isGurumiAdminConfigured,
  takeGurumiAdminLoginLimit,
  verifyGurumiAdminPassword,
} from "@/lib/gurumi/admin-auth";
import {
  GURUMI_VISIBILITY_BATCH_LIMIT,
  isGurumiGiftMinimumScore,
  isGurumiRecordId,
  normalizeGurumiName,
  type GurumiAdminData,
} from "@/lib/gurumi/records";
import {
  deleteGurumiScore,
  loadGurumiAdminData,
  updateGurumiGiftMinimumScore,
  updateGurumiGiftReceived,
  updateGurumiName,
  updateGurumiScoreVisibility,
} from "@/lib/gurumi/storage";

export type GurumiAdminActionResult =
  | { ok: true; data: GurumiAdminData; message?: string }
  | { ok: false; error: string; unauthorized?: true };

function unauthorizedResult(): GurumiAdminActionResult {
  return {
    ok: false,
    error: "관리자 세션이 만료됐습니다. 다시 로그인해 주세요.",
    unauthorized: true,
  };
}

export async function loginGurumiAdmin(password: string): Promise<GurumiAdminActionResult> {
  if (!isGurumiAdminConfigured()) {
    return { ok: false, error: "관리자 비밀번호가 서버에 설정되지 않았습니다." };
  }
  const rateLimit = await takeGurumiAdminLoginLimit();
  if (!rateLimit.allowed) {
    return {
      ok: false,
      error: `로그인 시도가 너무 많습니다. ${Math.ceil(rateLimit.retryAfterSeconds / 60)}분 후 다시 시도해 주세요.`,
    };
  }
  if (!verifyGurumiAdminPassword(password)) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return { ok: false, error: "비밀번호가 올바르지 않습니다." };
  }

  try {
    await createGurumiAdminSession();
    return { ok: true, data: await loadGurumiAdminData() };
  } catch {
    return { ok: false, error: "관리자 화면을 불러오지 못했습니다." };
  }
}

export async function logoutGurumiAdmin() {
  await deleteGurumiAdminSession();
}

export async function refreshGurumiAdminRecords(): Promise<GurumiAdminActionResult> {
  if (!(await isGurumiAdminAuthenticated())) return unauthorizedResult();
  try {
    return { ok: true, data: await loadGurumiAdminData() };
  } catch {
    return { ok: false, error: "기록을 새로 불러오지 못했습니다." };
  }
}

// 점수는 서버 채점값이라 관리자도 바꿀 수 없다. 입력에 score가 섞여 와도 읽지 않는다.
export async function updateGurumiAdminRecordName(input: {
  id: string;
  name: string;
}): Promise<GurumiAdminActionResult> {
  if (!(await isGurumiAdminAuthenticated())) return unauthorizedResult();
  const name = normalizeGurumiName(input.name);
  if (!isGurumiRecordId(input.id) || !name) {
    return { ok: false, error: "닉네임은 2–10자로 입력해 주세요." };
  }

  try {
    const updated = await updateGurumiName({ id: input.id, name });
    if (!updated) return { ok: false, error: "수정할 기록을 찾지 못했습니다." };
    return {
      ok: true,
      data: await loadGurumiAdminData(),
      message: `${name} 닉네임을 수정했습니다.`,
    };
  } catch {
    return { ok: false, error: "닉네임을 수정하지 못했습니다." };
  }
}

export async function deleteGurumiAdminRecord(id: string): Promise<GurumiAdminActionResult> {
  if (!(await isGurumiAdminAuthenticated())) return unauthorizedResult();
  if (!isGurumiRecordId(id)) return { ok: false, error: "삭제할 기록이 올바르지 않습니다." };

  try {
    const deleted = await deleteGurumiScore(id);
    if (!deleted) return { ok: false, error: "삭제할 기록을 찾지 못했습니다." };
    return {
      ok: true,
      data: await loadGurumiAdminData(),
      message: "기록을 삭제했습니다.",
    };
  } catch {
    return { ok: false, error: "기록을 삭제하지 못했습니다." };
  }
}

export async function setGurumiAdminGiftMinimumScore(minimumScore: number): Promise<GurumiAdminActionResult> {
  if (!(await isGurumiAdminAuthenticated())) return unauthorizedResult();
  if (!isGurumiGiftMinimumScore(minimumScore)) {
    return { ok: false, error: "선물 기준은 1–100의 정수로 입력해 주세요." };
  }

  try {
    await updateGurumiGiftMinimumScore(minimumScore);
    return {
      ok: true,
      data: await loadGurumiAdminData(),
      message: `선물 기준을 ${minimumScore}점으로 저장했습니다.`,
    };
  } catch {
    return { ok: false, error: "선물 기준을 저장하지 못했습니다." };
  }
}

export async function setGurumiAdminGiftReceived(id: string, received: boolean): Promise<GurumiAdminActionResult> {
  if (!(await isGurumiAdminAuthenticated())) return unauthorizedResult();
  if (!isGurumiRecordId(id) || typeof received !== "boolean") {
    return { ok: false, error: "선물 지급 기록이 올바르지 않습니다." };
  }

  try {
    if (!(await updateGurumiGiftReceived(id, received))) {
      return { ok: false, error: "지급 상태를 기록할 참가 기록을 찾지 못했습니다." };
    }
    return {
      ok: true,
      data: await loadGurumiAdminData(),
      message: received ? "선물 지급을 기록했습니다." : "선물 지급 기록을 취소했습니다.",
    };
  } catch {
    return { ok: false, error: "선물 지급 상태를 저장하지 못했습니다." };
  }
}

export async function setGurumiAdminRecordVisibility(ids: string[], isVisible: boolean): Promise<GurumiAdminActionResult> {
  if (!(await isGurumiAdminAuthenticated())) return unauthorizedResult();
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > GURUMI_VISIBILITY_BATCH_LIMIT ||
      !ids.every(isGurumiRecordId) || typeof isVisible !== "boolean") {
    return { ok: false, error: "노출 상태를 변경할 기록을 다시 선택해 주세요." };
  }

  try {
    const updated = await updateGurumiScoreVisibility([...new Set(ids)], isVisible);
    if (updated === 0) return { ok: false, error: "노출 상태를 변경할 기록을 찾지 못했습니다." };
    return {
      ok: true,
      data: await loadGurumiAdminData(),
      message: `${updated}건을 ${isVisible ? "노출" : "미노출"} 상태로 설정했습니다.`,
    };
  } catch {
    return { ok: false, error: "기록의 노출 상태를 변경하지 못했습니다." };
  }
}
