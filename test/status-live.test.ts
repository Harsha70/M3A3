// import request from "supertest";
import { pollWithRetry } from "../utils/retryPoll.ts";

describe("Long polling with retries", () => {
  it("should eventually return thumbnail url", async () => {
    const userId = 3;

    const result = await pollWithRetry(userId, 5, 1000);
    expect(result.status).toBe("done");
    expect(result.thumbnailUrl).toBeDefined();
  });
});
