import socketio, eventlet
from flask import Flask

sio = socketio.Server(
    cors_allowed_origins="*",
    async_mode="eventlet",
    path="/api"
)
app = Flask(__name__)
app.wsgi_app = socketio.WSGIApp(
    socketio_app=sio,
    wsgi_app=app.wsgi_app,
    socketio_path="api"
)

updates = []
doc = "Start document"
pending = []

def apply_changes(doc: str, change_json) -> str:
    """
    Robustly apply *one* CM6 ChangeSet JSON entry to `doc`.
    Handles all of these forms:
      • Single-change: [pos, [del, ins...]]
      • Pure delete:   [pos, [del]]
      • Multi-op:      [skip0, [del0, ins0...], skip1, [del1, ins1...], …]
      • Multi-line:    insertion payloads that are themselves arrays of lines

    Algorithm:
      1. Treat change_json as a flat sequence of skip and change items.
      2. For each skip, copy that many chars from `doc` to the output.
      3. For each change, delete `del_len` chars and splice in the joined `ins_parts`.
      4. Continue until you exhaust the sequence, then copy the remainder of `doc`.
    """
    if not isinstance(change_json, (list, tuple)):
        raise ValueError(f"Invalid ChangeSet JSON: {change_json!r}")

    seq = list(change_json)
    if seq and not isinstance(seq[0], int):
        seq.insert(0, 0)

    out = []
    pos = 0
    i = 0
    n = len(seq)

    while i < n:
        skip = seq[i]
        if not isinstance(skip, int):
            raise ValueError(f"Expected skip=int at index {i}, got {skip!r}")
        out.append(doc[pos : pos + skip])
        pos += skip
        i += 1

        if i < n:
            change = seq[i]
            i += 1

            if isinstance(change, (list, tuple)):
                del_len = change[0]
                ins_parts = [str(seg) for seg in change[1:]]
                ins = "\n".join(ins_parts)
            elif isinstance(change, int):
                del_len, ins = change, ""
            else:
                raise ValueError(f"Unexpected change element: {change!r}")

            out.append(ins)
            pos += del_len

    # 3) TRAILING TEXT
    out.append(doc[pos:])
    return "".join(out)

@sio.event
def connect(sid, environ):
    print(f"Client {sid} connected")

@sio.event
def getDocument(sid):
    sio.emit("getDocumentResponse",
             {"version": len(updates), "doc": doc},
             to=sid)

@sio.event
def pullUpdates(sid, version):
    if version < len(updates):
        sio.emit("pullUpdateResponse",
                 {"updates": updates[version:]},
                 to=sid)
    else:
        pending.append((sid, version))

@sio.event
def pushUpdates(sid, version, client_updates):
    global doc
    if version != len(updates):
        return sio.emit("pushUpdateResponse", False, to=sid)

    try:
        print("\nUpdates")
        print(client_updates)
        for upd in client_updates:
            updates.append(upd)
            doc = apply_changes(doc, upd["changes"])

        print(doc)

        sio.emit("pushUpdateResponse", True, to=sid)

        for psid, pver in pending:
            if pver < len(updates):
                sio.emit("pullUpdateResponse", {"updates": updates[pver:]}, to=psid)
        pending.clear()

    except Exception as e:
        print("Error applying updates:", e)
        sio.emit("pushUpdateResponse", False, to=sid)

@sio.event
def disconnect(sid):
    print(f"Client {sid} disconnected")
    global pending
    pending = [(psid, v) for (psid, v) in pending if psid != sid]

if __name__ == "__main__":
    print("Starting server on port 8000 …")
    eventlet.wsgi.server(eventlet.listen(("", 8000)), app)
