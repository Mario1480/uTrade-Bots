import http from "http";
import { routeRequest } from "./routes.js";

export function createServer() {
  return http.createServer((req, res) => {
    routeRequest(req, res);
  });
}
