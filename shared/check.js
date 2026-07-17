import {createPool} from './utils/pg'
import {godNode} from './utils/utils'
import {ApiError} from './api'
import {normalizeAddress} from './security'

export async function checkInvitationLimit(inviter, epoch, db = createPool()) {
  if (!inviter) {
    throw new ApiError(400, 'the invitation code is missing')
  }

  const normalizedInviter = normalizeAddress(inviter, 'inviter')

  if (normalizedInviter === godNode()) {
    return true
  }

  const invitationsQuery = await db.query(
    `
select count(*)
from keys
where epoch = $1 and inviter = $2`,
    [epoch, normalizedInviter]
  )

  if (Number(invitationsQuery.rows[0]?.count || 0) >= 4) {
    throw new ApiError(400, 'inviter has reached the limit of 4 API keys')
  }

  return true
}
