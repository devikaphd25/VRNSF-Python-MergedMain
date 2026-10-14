import express from 'express';
import { createSession, joinSession } from '../services/class-sessions.repository.js';
import { instructorContent } from '../services/content.repository.js';
const router = express.Router();
router.post('/class-sessions', async (req, res) => { try {
    res.json(await createSession(Number(req.body?.instructorId), req.body?.accessCode));
}
catch (e) {
    res.status(400).json({ message: e instanceof Error ? e.message : 'Could not create class' });
} });
router.post('/class-sessions/join', async (req, res) => {
    try {
        const deviceId = String(req.body?.deviceId ?? '').trim();
        if (!deviceId)
            throw Error('Device ID required');
        res.json(await joinSession(deviceId, req.body?.name));
    }
    catch (e) {
        res.status(400).json({ message: e instanceof Error ? e.message : 'Could not join class' });
    }
});
router.get('/instructor-content', async (req, res) => { try {
    const roomId = req.query.sessionId;
    if (typeof roomId !== 'string' || !/^[1-9][0-9]*$/.test(roomId)) {
        return res.status(400).json({message: 'Join or create a class before loading its activities.'});
    }
    res.json(await instructorContent(roomId));
}
catch (e) {
    console.error('[Content]', e);
    res.status(503).json({ message: 'Course content is unavailable. Check server database configuration.' });
} });
export default router;
