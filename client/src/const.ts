export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** Path to the local login page. */
export const LOGIN_PATH = "/login";

/**
 * Backwards-compatible helper. Originally pointed to the Manus OAuth portal;
 * now it just returns the local login route so any caller keeps working.
 */
export const getLoginUrl = (): string => LOGIN_PATH;
