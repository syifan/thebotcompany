import React, { createContext, useState, useCallback, useEffect } from 'react'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [authPassword, setAuthPassword] = useState(() => localStorage.getItem('tbc_password') || '')
  const [isWriteMode, setIsWriteMode] = useState(false)
  const [loginModal, setLoginModal] = useState(false)
  const [loginInput, setLoginInput] = useState('')

  const authHeaders = useCallback(() => {
    if (!authPassword) return {}
    return { 'Authorization': 'Basic ' + btoa(':' + authPassword) }
  }, [authPassword])

  const authFetch = useCallback((url, opts = {}) => {
    const headers = { ...opts.headers, ...authHeaders() }
    return fetch(url, { ...opts, headers })
  }, [authHeaders])

  const checkAuth = useCallback(async (password) => {
    try {
      const headers = password ? { 'Authorization': 'Basic ' + btoa(':' + password) } : {}
      const res = await fetch('/api/auth', { headers })
      const data = await res.json()
      setIsWriteMode(data.authenticated)
      return data.authenticated
    } catch { return false }
  }, [])

  useEffect(() => { checkAuth(authPassword) }, [])

  const handleLogin = useCallback(async () => {
    const ok = await checkAuth(loginInput)
    if (ok) {
      setAuthPassword(loginInput)
      localStorage.setItem('tbc_password', loginInput)
      setLoginModal(false)
      setLoginInput('')
    } else {
      setLoginInput('')
    }
  }, [loginInput, checkAuth])

  const handleLogout = useCallback(() => {
    setAuthPassword('')
    setIsWriteMode(false)
    localStorage.removeItem('tbc_password')
  }, [])

  const value = {
    authPassword,
    isWriteMode,
    loginModal,
    setLoginModal,
    loginInput,
    setLoginInput,
    authFetch,
    checkAuth,
    handleLogin,
    handleLogout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
