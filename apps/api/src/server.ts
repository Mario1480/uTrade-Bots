import http from "http";
import { routeRequest } from "./routes/index.js";

export function createServer() {
  return http.createServer((req, res) => {
    routeRequest(req, res);
  });
}
