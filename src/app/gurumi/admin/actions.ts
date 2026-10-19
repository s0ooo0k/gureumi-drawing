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
  isGurumiRecordId,
  normalizeGurumiName,
  type ScoreRecord,
} from "@/lib/gurumi/records";
import {
  deleteGurumiScore,
  listGurumiScores,
  updateGurumiScore,
} from "@/lib/gurumi/storage";

export type GurumiAdminActionResult =
  | { ok: true; records: ScoreRecord[]; message?: string }
  | { ok: false; error: string; unauthorized?: true };

function unauthorizedResult(): GurumiAdminActionResult {
  return {
    ok: false,
    error: "관리자 세션이 만료됐습니다. 다시 로그인해 주세요.",
    unauthorized: true,
  };
}

async function currentRecords() {
  return listGurumiScores();
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
    return { ok: true, records: await currentRecords() };
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
    return { ok: true, records: await currentRecords() };
  } catch {
    return { ok: false, error: "기록을 새로 불러오지 못했습니다." };
  }
}

export async function updateGurumiAdminRecord(input: {
  id: string;
  name: string;
  score: number;
}): Promise<GurumiAdminActionResult> {
  if (!(await isGurumiAdminAuthenticated())) return unauthorizedResult();
  const name = normalizeGurumiName(input.name);
  const score = Number(input.score);
  if (!isGurumiRecordId(input.id) || !name || !Number.isInteger(score) || score < 0 || score > 100) {
    return { ok: false, error: "닉네임은 2–10자, 점수는 0–100의 정수로 입력해 주세요." };
  }

  try {
    const updated = await updateGurumiScore({ id: input.id, name, score });
    if (!updated) return { ok: false, error: "수정할 기록을 찾지 못했습니다." };
    return {
      ok: true,
      records: await currentRecords(),
      message: `${name} 기록을 수정했습니다.`,
    };
  } catch {
    return { ok: false, error: "기록을 수정하지 못했습니다." };
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
      records: await currentRecords(),
      message: "기록을 삭제했습니다.",
    };
  } catch {
    return { ok: false, error: "기록을 삭제하지 못했습니다." };
  }
}
