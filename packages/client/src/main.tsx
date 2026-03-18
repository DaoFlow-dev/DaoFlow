import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { makeQueryClient, makeTrpcClient, trpc } from "./lib/trpc";
import { ThemeProvider } from "./components/ThemeProvider";
import "./index.css";

const queryClient = makeQueryClient();
const trpcClient = makeTrpcClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </trpc.Provider>
    </ThemeProvider>
  </React.StrictMode>
);
