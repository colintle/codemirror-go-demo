import { Component } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { langs } from "@uiw/codemirror-extensions-langs";
// remove basicSetup import
import { indentUnit } from "@codemirror/language";
import { keymap, EditorView } from "@codemirror/view";

import type { Socket } from "socket.io-client";
import { getDocument, peerExtension } from "../utils/collab";

type Mode = "light" | "dark";

type State = {
  connected: boolean;
  version: number | null;
  doc: string | null;
  mode: Mode;
};

type Props = {
  socket: Socket;
  className?: string;
};

// ─── Custom keymaps ────────────────────────────────────────────────────

// Always insert a literal tab character
const insertTab = keymap.of([
  {
    key: "Tab",
    preventDefault: true,
    run(view: EditorView) {
      const pos = view.state.selection.main.head;
      view.dispatch({
        changes: { from: pos, to: pos, insert: "\t" },
        selection: { anchor: pos + 1 },
        userEvent: "input",
      });
      return true;
    },
  },
]);

// Always insert a literal newline
const insertNewline = keymap.of([
  {
    key: "Enter",
    preventDefault: true,
    run(view: EditorView) {
      const pos = view.state.selection.main.head;
      view.dispatch({
        changes: { from: pos, to: pos, insert: "\n" },
        selection: { anchor: pos + 1 },
        userEvent: "input",
      });
      return true;
    },
  },
]);

// ─── Component ─────────────────────────────────────────────────────────

class EditorElement extends Component<Props, State> {
  state: State = {
    connected: false,
    version: null,
    doc: null,
    mode:
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : ("light" as Mode),
  };

  async componentDidMount() {
    const { version, doc } = await getDocument(this.props.socket);
    this.setState({ version, doc });

    this.props.socket.on("connect", () => this.setState({ connected: true }));
    this.props.socket.on("disconnect", () =>
      this.setState({ connected: false })
    );
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) =>
        this.setState({ mode: e.matches ? "dark" : "light" })
      );
  }

  componentWillUnmount() {
    this.props.socket.off("connect");
    this.props.socket.off("disconnect");
    this.props.socket.off("pullUpdateResponse");
    this.props.socket.off("pushUpdateResponse");
    this.props.socket.off("getDocumentResponse");
  }

  render() {
    const { version, doc, mode } = this.state;
    if (version === null || doc === null) {
      return <span>loading...</span>;
    }

    return (
      <CodeMirror
        className={`flex-1 overflow-scroll text-left ${this.props.className}`}
        height="100%"
        basicSetup={false}
        theme={mode}
        extensions={[
          indentUnit.of("\t"),
          insertTab,
          insertNewline,
          langs.c(),
          peerExtension(this.props.socket, version),
        ]}
        value={doc}
      />
    );
  }
}

export default EditorElement;
