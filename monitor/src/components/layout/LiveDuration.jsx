import React, { useState, useEffect } from 'react'

export default function LiveDuration({ startTime }) {
  const [display, setDisplay] = useState('')
  useEffect(() => {
    const update = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      if (elapsed < 60) setDisplay(`${elapsed}s`)
      else setDisplay(`${Math.floor(elapsed / 60)}m ${elapsed % 60}s`)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [startTime])
  return <span>{display}</span>
}
