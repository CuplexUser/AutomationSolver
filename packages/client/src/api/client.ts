import type { GradeResult, LadderProgram, PuzzleSpec, ValidationResult } from '@automationsolver/shared';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return body as T;
}

export interface PublicUser {
  id: number;
  email: string | null;
  displayName: string;
}

export interface PuzzleListItem {
  slug: string;
  title: string;
  difficulty: PuzzleSpec['difficulty'];
  order: number;
  summary: string;
  status: 'unsolved' | 'in_progress' | 'solved';
  bestScore: number;
}

export interface PuzzleDetail {
  puzzle: PuzzleSpec;
  savedProgram: LadderProgram | null;
  progress: { status: string; bestScore: number } | null;
}

export interface SubmitResult {
  validation: ValidationResult;
  grade: GradeResult | null;
}

export const authApi = {
  me: () => api<{ user: PublicUser }>('/auth/me'),
  providers: () => api<{ google: boolean; github: boolean }>('/auth/providers'),
  login: (email: string, password: string) =>
    api<{ user: PublicUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, displayName?: string) =>
    api<{ user: PublicUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
};

export const puzzleApi = {
  list: () => api<{ puzzles: PuzzleListItem[] }>('/puzzles'),
  detail: (slug: string) => api<PuzzleDetail>(`/puzzles/${slug}`),
  saveDraft: (slug: string, program: LadderProgram) =>
    api<{ saved: boolean }>(`/puzzles/${slug}/solution`, {
      method: 'PUT',
      body: JSON.stringify({ program }),
    }),
  submit: (slug: string, program: LadderProgram) =>
    api<SubmitResult>(`/puzzles/${slug}/submit`, {
      method: 'POST',
      body: JSON.stringify({ program }),
    }),
};

export const settingsApi = {
  get: () => api<{ settings: Record<string, unknown> }>('/settings'),
  put: (settings: Record<string, unknown>) =>
    api<{ settings: Record<string, unknown> }>('/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    }),
};
