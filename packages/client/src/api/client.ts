import type {
  GradeResult,
  LadderProgram,
  PuzzleCategory,
  PuzzleSpec,
  ValidationResult,
  WiringDoc,
} from '@automationsolver/shared';

/** A saved/submitted solution document — shape depends on the puzzle kind. */
export type PuzzleProgram = LadderProgram | WiringDoc;

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
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
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText, body as Record<string, unknown>);
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
  category: PuzzleCategory;
  summary: string;
  status: 'unsolved' | 'in_progress' | 'solved';
  bestScore: number;
  locked: boolean;
  requiresTitle?: string;
}

export interface SolutionSlot {
  id: number;
  name: string;
  updatedAt: number;
  isSubmitted: boolean;
}

export interface SolutionSlotDetail extends SolutionSlot {
  program: PuzzleProgram;
}

export interface PuzzleDetail {
  puzzle: PuzzleSpec;
  slots: SolutionSlot[];
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
  submit: (slug: string, program: PuzzleProgram) =>
    api<SubmitResult>(`/puzzles/${slug}/submit`, {
      method: 'POST',
      body: JSON.stringify({ program }),
    }),
};

export const slotApi = {
  list: (slug: string) => api<{ slots: SolutionSlot[] }>(`/puzzles/${slug}/slots`),
  get: (slug: string, id: number) => api<SolutionSlotDetail>(`/puzzles/${slug}/slots/${id}`),
  create: (slug: string, program: PuzzleProgram, name?: string) =>
    api<SolutionSlot>(`/puzzles/${slug}/slots`, {
      method: 'POST',
      body: JSON.stringify({ program, name }),
    }),
  update: (slug: string, id: number, patch: { name?: string; program?: PuzzleProgram }) =>
    api<SolutionSlot>(`/puzzles/${slug}/slots/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  remove: (slug: string, id: number) => api<void>(`/puzzles/${slug}/slots/${id}`, { method: 'DELETE' }),
};

export const settingsApi = {
  get: () => api<{ settings: Record<string, unknown> }>('/settings'),
  put: (settings: Record<string, unknown>) =>
    api<{ settings: Record<string, unknown> }>('/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    }),
};
