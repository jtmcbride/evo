import { useSyncExternalStore } from "react";
import type { WorkbenchStore } from "./store";
export const useView = (store: WorkbenchStore) =>
  useSyncExternalStore(store.subscribe, store.getView);
export const useInspection = (store: WorkbenchStore) =>
  useSyncExternalStore(store.subscribeInspection, store.getInspection);
