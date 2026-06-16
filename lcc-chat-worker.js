const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const key = "room:main";

    let messages = [];
    const stored = await env.CHAT_KV.get(key);
    if (stored) messages = JSON.parse(stored);

    // SEND MESSAGE (supports text, avatar emoji, and compressed image attachments)
    if (action === "send") {
      const m = await req.json();

      // Fallback check for oversized image payloads
      if (m.imageData && m.imageData.length > 2_800_000) {
        return new Response("image too large", { status: 413, headers: cors });
      }

      messages.push({
        id: crypto.randomUUID(),
        user: m.user,
        text: m.text || "",
        avatar: m.avatar || null,
        imageData: m.imageData || null,
        imageType: m.imageType || null,
        time: Date.now(),
        deleted: false,
        edited: false,
        reactions: {}
      });

      // Trim to last 200 messages to keep KV lean
      if (messages.length > 200) messages = messages.slice(-200);

      await env.CHAT_KV.put(key, JSON.stringify(messages));
      return new Response("ok", { headers: cors });
    }

    // EDIT MESSAGE (Owner or Admin only)
    if (action === "edit") {
      const { id, user, admin, text } = await req.json();
      const msg = messages.find(m => m.id === id);

      if (!msg) {
        return new Response("not found", { status: 404, headers: cors });
      }

      if (msg.user === user || admin === true) {
        msg.text = text || "";
        msg.edited = true;
        await env.CHAT_KV.put(key, JSON.stringify(messages));
        return new Response("edited", { headers: cors });
      }

      return new Response("forbidden", { status: 403, headers: cors });
    }

    // REACT
    if (action === "react") {
      const { id, emoji } = await req.json();
      const msg = messages.find(m => m.id === id);
      if (msg && !msg.deleted && emoji) {
        msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;
        await env.CHAT_KV.put(key, JSON.stringify(messages));
      }
      return new Response("ok", { headers: cors });
    }

    // UNREACT (supported by the lcc-chat reaction toggle)
    if (action === "unreact") {
      const { id, emoji } = await req.json();
      const msg = messages.find(m => m.id === id);
      if (msg && !msg.deleted && emoji && msg.reactions[emoji]) {
        msg.reactions[emoji] -= 1;
        if (msg.reactions[emoji] <= 0) delete msg.reactions[emoji];
        await env.CHAT_KV.put(key, JSON.stringify(messages));
      }
      return new Response("ok", { headers: cors });
    }

    // DELETE (Owner or Admin only)
    if (action === "delete") {
      const { id, user, admin } = await req.json();
      const msg = messages.find(m => m.id === id);

      if (!msg) {
        return new Response("not found", { status: 404, headers: cors });
      }

      if (msg.user === user || admin === true) {
        msg.deleted = true;
        await env.CHAT_KV.put(key, JSON.stringify(messages));
        return new Response("deleted", { headers: cors });
      }

      return new Response("forbidden", { status: 403, headers: cors });
    }

    // GET MESSAGES
    return new Response(JSON.stringify(messages), {
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
};
