import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    duplicate_apply: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 30),
      duration: __ENV.DURATION || "20s"
    }
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.02"]
  }
};

const baseUrl = __ENV.BASE_URL || "http://localhost:8080";

export default function () {
  const response = http.post(
    `${baseUrl}/api/v1/jobs/${__ENV.JOB_ID}/applications`,
    JSON.stringify({ coverLetter: "k6 concurrency verification" }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${__ENV.ACCESS_TOKEN}`,
        "Idempotency-Key": __ENV.IDEMPOTENCY_KEY || "k6-same-request"
      }
    }
  );
  check(response, { "idempotent response is successful": (res) => res.status === 200 || res.status === 201 });
  sleep(0.1);
}
