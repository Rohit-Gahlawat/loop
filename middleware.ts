export { default } from "next-auth/middleware";

/** Every application route requires a session. Signed-out users land on /login. */
export const config = {
  matcher: ["/dashboard/:path*", "/inbox/:path*", "/trends/:path*", "/ask/:path*", "/reports/:path*", "/settings/:path*"],
};
