#!/usr/bin/env osascript

-- Extract all supplier invoices from October 2025 from Outlook mailbox
-- Target: info@cromwellfreight.com
-- Output: JSON with invoice data

use framework "Foundation"

set output to {}
set invoiceCount to 0

tell application "Microsoft Outlook"
    -- Get the account for Cromwell Freight
    set accountName to "info@cromwellfreight.com"

    -- Get messages from October 2025
    -- Search criteria: October 2025, contains invoice/bill/statement keywords
    set searchResults to {}

    try
        -- Search inbox for October emails with invoice keywords
        set searchString to "subject:(invoice OR bill OR credit note OR receipt OR statement) received:10/01/2025..10/31/2025"

        -- Get all folders
        set inboxFolder to inbox of account accountName

        -- Search in inbox
        set foundMessages to {}
        repeat with msg in messages of inboxFolder
            set msgDate to time received of msg
            set msgSubject to subject of msg
            set msgSender to sender of msg

            -- Check if October 2025
            set dateString to (msgDate as string)
            if dateString contains "October" or dateString contains "10/2025" then
                -- Check if looks like invoice
                if msgSubject contains "invoice" or msgSubject contains "bill" or msgSubject contains "credit" or msgSubject contains "invoice" then
                    set end of foundMessages to msg
                end if
            end if
        end repeat

        -- Extract data from found messages
        repeat with msg in foundMessages
            set msgSubject to subject of msg
            set msgSender to sender of msg
            set msgDate to time received of msg
            set msgBody to plain text content of msg

            -- Get attachments
            set attachmentList to {}
            repeat with att in attachments of msg
                set attName to name of att
                set end of attachmentList to attName
            end repeat

            -- Create invoice record
            set invoiceData to {¬
                subject: msgSubject, ¬
                sender: (name of msgSender), ¬
                senderEmail: (address of msgSender), ¬
                date: (msgDate as string), ¬
                attachments: attachmentList, ¬
                bodyPreview: (text 1 thru 200 of msgBody) ¬
            }

            set end of output to invoiceData
            set invoiceCount to invoiceCount + 1
        end repeat

    end try
end tell

-- Output results
log ("Found " & invoiceCount & " October invoices")
return output
