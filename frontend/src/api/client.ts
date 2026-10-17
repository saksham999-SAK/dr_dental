import {
  AnalysisResponse,
  HealthResponse,
  ModelsInfoResponse,
} from '../types/api';

function isLocalHost(value: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(value);
}

function normalizeApiBaseUrl(raw: string): string {
  let url = raw.trim();
  url = url.replace(/\/+$/, '');
  // Allow pasting a full endpoint like https://host/api/analyze
  url = url.replace(/\/api(?:\/analyze)?$/i, '');
  if (!/^https?:\/\//i.test(url)) {
    const isLocal = url.startsWith('localhost') || url.startsWith('127.0.0.1');
    url = `${isLocal ? 'http' : 'https'}://${url}`;
  }
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

const PRODUCTION_API = 'https://drdental-production.up.railway.app';

function resolveApiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '';
  const pageHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const pageIsLocal = !pageHost || isLocalHost(pageHost);

  // On Vercel (or any deployed host) never call localhost — browsers report that
  // as "Failed to fetch". Prefer an explicit non-local env, else Railway.
  if (!pageIsLocal) {
    if (raw && !isLocalHost(raw)) {
      return normalizeApiBaseUrl(raw);
    }
    return PRODUCTION_API;
  }
  return normalizeApiBaseUrl(raw || 'http://localhost:8005');
}

const API_BASE_URL = resolveApiBaseUrl();

function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${suffix}`;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number = 500) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function fetchApi(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    const target = API_BASE_URL || window.location.origin;
    throw new ApiError(
      `Cannot reach the analysis engine at ${target}. ${err instanceof Error ? err.message : ''}`.trim(),
      0,
    );
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorDetail = `Request failed with status ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.detail) {
        errorDetail = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
      }
    } catch {
      // Ignore JSON parse error and use status message
    }
    throw new ApiError(errorDetail, res.status);
  }
  return res.json() as Promise<T>;
}

export const apiClient = {
  getBaseUrl(): string {
    return API_BASE_URL;
  },

  async getHealth(): Promise<HealthResponse> {
    const res = await fetchApi(apiUrl('/api/health'));
    return handleResponse<HealthResponse>(res);
  },

  async getModelsInfo(): Promise<ModelsInfoResponse> {
    const res = await fetchApi(apiUrl('/api/models/info'));
    return handleResponse<ModelsInfoResponse>(res);
  },

  async uploadAndAnalyze(
    file: File | Blob,
    filename: string = 'scan.jpg',
    enumerationConf?: number,
    diseaseConf?: number
  ): Promise<AnalysisResponse> {
    const formData = new FormData();
    formData.append('file', file, filename);
    if (enumerationConf !== undefined) {
      formData.append('enumeration_conf', enumerationConf.toString());
    }
    if (diseaseConf !== undefined) {
      formData.append('disease_conf', diseaseConf.toString());
    }

    const res = await fetchApi(apiUrl('/api/analyze'), {
      method: 'POST',
      body: formData,
    });
    return handleResponse<AnalysisResponse>(res);
  },

  async getAnalysis(analysisId: string): Promise<AnalysisResponse> {
    const res = await fetchApi(apiUrl(`/api/analysis/${encodeURIComponent(analysisId)}`));
    return handleResponse<AnalysisResponse>(res);
  },

  getOriginalImageUrl(analysisId: string): string {
    return apiUrl(`/api/analysis/${encodeURIComponent(analysisId)}/image/original`);
  },

  getAnnotatedImageUrl(analysisId: string): string {
    return apiUrl(`/api/analysis/${encodeURIComponent(analysisId)}/image/annotated`);
  },

  getTeethOnlyImageUrl(analysisId: string): string {
    return apiUrl(`/api/analysis/${encodeURIComponent(analysisId)}/image/teeth_only`);
  },

  getDiseasesOnlyImageUrl(analysisId: string): string {
    return apiUrl(`/api/analysis/${encodeURIComponent(analysisId)}/image/diseases_only`);
  },

  getReportDownloadUrl(analysisId: string): string {
    return apiUrl(`/api/analysis/${encodeURIComponent(analysisId)}/report`);
  },
};
