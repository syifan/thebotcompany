import React from 'react'
import { Github } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="mt-12 py-6 border-t border-neutral-200 dark:border-neutral-700">
      <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-sm text-neutral-400 dark:text-neutral-500">
        <span>TheBotCompany</span>
        <span className="hidden sm:inline">·</span>
        <a 
          href="https://github.com/syifan/thebotcompany" 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
        >
          <Github className="w-4 h-4" />
          GitHub
        </a>
      </div>
    </footer>
  )
}
