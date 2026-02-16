# TODO

## SPITR TEAM — Sybil Create Bug (BLOCKING)

`POST /api/bot/sybil/create` is not reliably setting `account_type` and `sybil_owner_id` on the `users` table row. Most sybil accounts end up with `account_type = NULL` instead of `'sybil'`, which causes `validateBotRequest()` to 404 on the fallback lookup when sybils try to like/reply/respit.

**To fix:**
1. In `/api/bot/sybil/create/route.ts`, ensure the `users` INSERT always sets `account_type = 'sybil'` and `sybil_owner_id = owner_user_id`
2. Verify the columns exist on the `users` table (run migration if needed)
3. Backfill existing broken rows:
```sql
UPDATE users SET account_type = 'sybil' WHERE id::text IN (SELECT user_id FROM sybil_bots WHERE user_id IS NOT NULL) AND (account_type IS NULL OR account_type != 'sybil');

UPDATE users u SET sybil_owner_id = ss.owner_user_id FROM sybil_bots sb JOIN sybil_servers ss ON sb.server_id = ss.id WHERE u.id::text = sb.user_id AND (u.sybil_owner_id IS NULL OR u.sybil_owner_id = '');
```

---

## Image Service Future Improvements

- [ ] Image preview thumbnails in recent files list (serve PNGs via Next.js API)
- [ ] Batch generation — generate N avatars/banners in one click
- [ ] Style presets — save/load named style configurations
- [ ] Generation queue with progress tracking (SSE from Python server)
- [ ] Image repair integration — link repair jobs from sybil scheduler to dashboard
- [ ] Per-bot image history — track which bot got which avatar/banner
- [ ] Style A/B testing — compare outputs of different prompts side by side
- [ ] GPU memory monitoring — show VRAM/MPS usage in stats HUD
- [ ] Auto-cleanup — configurable max output dir size with oldest-first purge
- [ ] Negative prompt support — add negative_prompt field to styles editor
