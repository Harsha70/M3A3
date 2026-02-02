import axios from "axios";

export async function pollWithRetry(
  userId: number,
  maxRetries = 5,
  baseDelay = 1000
) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      // console.log(`Attempt ${attempt + 1} of ${maxRetries}`);
      const res = await axios.get(
        `http://localhost:3010/status-live/${userId}`,
        { timeout: 35000 }
      );
      if (res.status === 200 && res.data.status === "done") {
        return res.data;
      }
      attempt++;
      const delay = Math.min(baseDelay * 2 ** attempt, 30000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (err) {
      attempt++;
      const delay = Math.min(baseDelay * 2 ** attempt, 30000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Failed to get thumbnail after multiple retries");
}
