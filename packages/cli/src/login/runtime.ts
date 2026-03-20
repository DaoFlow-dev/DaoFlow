import { createInterface } from "node:readline";
import { tryOpenBrowser } from "../browser";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface LoginRuntime {
  fetch(this: void, input: string | URL | Request, init?: RequestInit): Promise<Response>;
  prompt(this: void, question: string): Promise<string>;
  sleep(this: void, ms: number): Promise<void>;
  tryOpenBrowser(this: void, url: string): boolean;
}

export const loginRuntime: LoginRuntime = {
  fetch: (input, init) => globalThis.fetch(input, init),
  prompt,
  sleep,
  tryOpenBrowser
};
