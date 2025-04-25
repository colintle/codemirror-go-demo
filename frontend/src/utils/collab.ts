import { Text, ChangeSet } from "@codemirror/state"
import { Update, receiveUpdates, sendableUpdates, collab, getSyncedVersion } from "@codemirror/collab"
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view"
import { Socket } from "socket.io-client"

function pushUpdates(
  socket: Socket,
  version: number,
  fullUpdates: readonly Update[]
): Promise<boolean> {
  const updates = fullUpdates.map(u => ({
    clientID: u.clientID,
    changes: u.changes.toJSON(),
    effects: u.effects
  }))

  return new Promise(resolve => {
    socket.emit("pushUpdates", version, updates)
    socket.once("pushUpdateResponse", (payload: { ok: boolean }) => {
      resolve(payload.ok)
    })
  })
}

function pullUpdates(
  socket: Socket,
  version: number
): Promise<readonly Update[]> {
  return new Promise(resolve => {
    socket.emit("pullUpdates", version)
    socket.once("pullUpdateResponse", (payload: { updates: any[] }) => {
      const raw = payload.updates
      resolve(raw.map(u => ({
        changes: ChangeSet.fromJSON(u.changes),
        clientID: u.clientID
      })))
    })
  })
}

export function getDocument(
  socket: Socket
): Promise<{ version: number; doc: string }> {
  return new Promise(resolve => {
    socket.emit("getDocument")
    socket.once(
      "getDocumentResponse",
      (payload: { version: number; doc: string }) => {
        resolve({
          version: payload.version,
          doc: payload.doc
        })
      }
    )
  })
}

export const peerExtension = (socket: Socket, startVersion: number) => {
  const plugin = ViewPlugin.fromClass(
    class {
      private pushing = false
      private done = false

      constructor(private view: EditorView) {
        this.pull()
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.transactions.length) this.push()
      }

      async push() {
        const updates = sendableUpdates(this.view.state)
        if (this.pushing || !updates.length) return
        this.pushing = true
        const version = getSyncedVersion(this.view.state)
        const ok = await pushUpdates(socket, version, updates)
        this.pushing = false
        if (sendableUpdates(this.view.state).length) setTimeout(() => this.push(), 100)
      }

      async pull() {
        while (!this.done) {
          const version = getSyncedVersion(this.view.state)
          const updates = await pullUpdates(socket, version)
          this.view.dispatch(receiveUpdates(this.view.state, updates))
        }
      }

      destroy() {
        this.done = true
      }
    }
  )
  return [collab({ startVersion }), plugin]
}
