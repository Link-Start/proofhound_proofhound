import axios from 'axios';
import { getServerBaseUrl } from './public-env';

export const httpClient = axios.create({
  baseURL: getServerBaseUrl(),
  headers: { 'Content-Type': 'application/json' },
});
