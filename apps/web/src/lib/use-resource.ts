"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "./http";
// Keep results tied to the requested tenant/range. A late response cannot populate another workspace.
export function useResource<T>(path: string, revision: number) {
  const [state, setState] = useState<{
    path: string;
    data: T | null;
    error: string;
  }>({ path, data: null, error: "" });
  const sequence = useRef(0);
  const current = useRef(path);
  current.current = path;
  const refresh = useCallback(async () => {
    const token = ++sequence.current;
    try {
      const data = await request<T>(path);
      if (current.current === path && token === sequence.current)
        setState({ path, data, error: "" });
    } catch (e) {
      if (current.current === path && token === sequence.current)
        setState({
          path,
          data: null,
          error: e instanceof Error ? e.message : "Could not load this view",
        });
      throw e;
    }
  }, [path]);
  useEffect(() => {
    let active = true;
    const token = ++sequence.current;
    request<T>(path)
      .then((data) => {
        if (active && token === sequence.current)
          setState({ path, data, error: "" });
      })
      .catch((e) => {
        if (active && token === sequence.current)
          setState({ path, data: null, error: e.message });
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return {
    data: state.path === path ? state.data : null,
    error: state.path === path ? state.error : "",
    refresh,
  };
}
