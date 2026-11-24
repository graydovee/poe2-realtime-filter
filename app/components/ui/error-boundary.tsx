"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "./button";

type Props = { children: ReactNode; title?: string };
type State = { error: Error | null };

/** 分区级错误边界：单个模块渲染出错时不拖垮整个窗口。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("界面模块渲染失败", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-ember/35 bg-ember/8 p-4">
        <p className="text-sm font-semibold text-ember">{this.props.title ?? "这一块界面出了问题"}</p>
        <p className="max-w-full break-words font-mono text-xs text-ink-muted">{this.state.error.message}</p>
        <Button size="sm" onClick={() => this.setState({ error: null })}>
          重试
        </Button>
      </div>
    );
  }
}
