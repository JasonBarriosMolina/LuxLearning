/**
 * Tests for POST /admin/email/send — el modal de redactar tiene campo CC, pero el
 * backend lo ignoraba y esas personas nunca recibían el correo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAdminCtx, makeEvent } from '../helpers/ctx';

const saveEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../shared/db-email', () => ({
  saveEmail: (...a: any[]) => saveEmailMock(...a),
  listSentEmails: vi.fn(),
}));

import { handleEmail } from '../../admin/email';
import { ses } from '../../admin/ctx';

const sesSend = vi.spyOn(ses, 'send') as any;

const send = (body: Record<string, unknown>) => handleEmail(makeAdminCtx({
  event: makeEvent('ADMIN', 'POST', '/admin/email/send'),
  method: 'POST', path: '/admin/email/send',
  body: { subject: 'Hola', bodyHtml: '<p>Hola</p>', ...body },
}) as any);

const destinationOf = (call: number) => sesSend.mock.calls[call][0].input.Destination;
const addrs = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}@example.com`);

beforeEach(() => { sesSend.mockReset(); sesSend.mockResolvedValue({}); saveEmailMock.mockClear(); });

describe('POST /admin/email/send — cc', () => {
  it('sends cc addresses as CcAddresses and keeps `to` in BCC', async () => {
    const res = await send({ to: ['a@example.com'], cc: ['c@example.com'] });
    expect(res.statusCode).toBe(200);
    expect(sesSend).toHaveBeenCalledTimes(1);
    expect(destinationOf(0)).toEqual({ BccAddresses: ['a@example.com'], CcAddresses: ['c@example.com'] });
    expect(saveEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: ['a@example.com'], cc: ['c@example.com'], recipientCount: 2 }));
  });

  it('does not add CcAddresses when there is no cc', async () => {
    await send({ to: ['a@example.com'] });
    expect(destinationOf(0)).toEqual({ BccAddresses: ['a@example.com'] });
    expect(saveEmailMock.mock.calls[0][0]).not.toHaveProperty('cc');
  });

  it('drops cc addresses that are already in `to`', async () => {
    await send({ to: ['a@example.com'], cc: ['a@example.com', 'c@example.com'] });
    expect(destinationOf(0).CcAddresses).toEqual(['c@example.com']);
  });

  it('puts cc on the first SES call only and keeps each call within the 50-address limit', async () => {
    const res = await send({ to: addrs(60, 'to'), cc: addrs(2, 'cc') });
    expect(res.statusCode).toBe(200);
    expect(sesSend).toHaveBeenCalledTimes(2);
    expect(destinationOf(0).BccAddresses).toHaveLength(48);
    expect(destinationOf(0).CcAddresses).toHaveLength(2);
    expect(destinationOf(1).BccAddresses).toHaveLength(12);
    expect(destinationOf(1)).not.toHaveProperty('CcAddresses');
  });

  it('rejects more than 20 cc recipients', async () => {
    const res = await send({ to: ['a@example.com'], cc: addrs(21, 'cc') });
    expect(res.statusCode).toBe(400);
    expect(sesSend).not.toHaveBeenCalled();
  });

  it('counts to + cc against the 100-recipient cap', async () => {
    const res = await send({ to: addrs(90, 'to'), cc: addrs(11, 'cc') });
    expect(res.statusCode).toBe(400);
    expect(sesSend).not.toHaveBeenCalled();
  });
});
