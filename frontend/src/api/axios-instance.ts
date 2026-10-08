import Axios, { type AxiosRequestConfig } from 'axios';

// In dev, Vite proxies /api to the FastAPI backend (see vite.config.ts).
export const axios = Axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '' });

/** Build a URL with the same base-path behavior Axios uses for generated API calls. */
export const apiUrl = (path: string): string => {
  const base = import.meta.env.VITE_API_URL ?? '';
  if (!base) return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
};

/** Orval mutator: every generated hook goes through this function. */
export const customInstance = <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> => axios({ ...config, ...options }).then(({ data }) => data);
