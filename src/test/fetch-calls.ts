import { isJsonString } from '@/lib/json';

/** The URL a recorded fetch call requested, whichever form the caller passed it in. */
export function requestUrl(input: RequestInfo | URL | undefined): string {
  if (input instanceof Request) return input.url;

  return input?.toString() ?? '';
}

/** The string body of a recorded fetch call; every Phoenix request in these tests sends JSON text. */
export function requestBodyText(init: RequestInit | undefined): string {
  const body = init?.body;

  if (!isJsonString(body)) throw new Error('Expected the request to send a string body.');

  return body;
}
