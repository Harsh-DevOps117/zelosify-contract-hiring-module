export function clearSessionCookies(response) {
  for (const name of ["access_token", "refresh_token", "role"]) {
    response.cookies.delete(name);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
