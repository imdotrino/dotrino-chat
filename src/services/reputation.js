// Puente al registro de reputación compartido (@dotrino/reputation, backend
// rep.dotrino.com), montado sobre el MISMO vault que la identidad. Singleton:
// lo consumen el store (calificar peers) y el topbar (modal "Mi perfil").

import { createVaultReputation } from '@dotrino/reputation'
import { getIdentity } from './identity'

let _rep = null

/** Instancia compartida de reputación (o null si no hay vault). */
export async function getReputation () {
  if (_rep) return _rep
  const id = await getIdentity()
  if (!id) return null
  try { _rep = createVaultReputation(id) } catch (_) { _rep = null }
  return _rep
}
