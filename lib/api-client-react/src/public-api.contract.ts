import {
  ApiError,
  getHealthCheckQueryKey,
  setAuthTokenGetter,
  setBaseUrl,
  useHealthCheck,
  type AuthTokenGetter,
  type HealthCheckQueryResult,
} from "@workspace/api-client-react";

type PublicApiContract = [
  typeof ApiError,
  typeof setBaseUrl,
  typeof setAuthTokenGetter,
  AuthTokenGetter,
  typeof useHealthCheck,
  typeof getHealthCheckQueryKey,
  HealthCheckQueryResult,
];

const publicApiContract: PublicApiContract | undefined = undefined;
void publicApiContract;