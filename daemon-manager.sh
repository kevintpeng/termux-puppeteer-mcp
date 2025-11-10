#!/data/data/com.termux/files/usr/bin/bash

# Daemon Manager for Browser Server in Alpine
# Manages the lifecycle of the persistent browser server

ALPINE_DIST="alpine"
SERVER_SCRIPT="/root/browser-server.js"
PID_FILE="/root/browser-server.pid"
LOG_FILE="/root/browser-server.log"

ACTION="${1:-status}"

case "$ACTION" in
  start)
    echo "🚀 Starting browser server in Alpine..."

    # Check if already running
    if proot-distro login $ALPINE_DIST -- test -f $PID_FILE; then
      PID=$(proot-distro login $ALPINE_DIST -- cat $PID_FILE 2>/dev/null)
      if proot-distro login $ALPINE_DIST -- sh -c "ps | grep -q '^\s*$PID\s'"; then
        echo "❌ Browser server is already running (PID: $PID)"
        exit 1
      else
        echo "⚠️  Stale PID file found, removing..."
        proot-distro login $ALPINE_DIST -- rm -f $PID_FILE
      fi
    fi

    # Copy browser-server.js to Alpine
    echo "📋 Copying browser-server.js to Alpine..."
    cat browser-server.js | proot-distro login $ALPINE_DIST -- sh -c "cat > $SERVER_SCRIPT"

    # Start the server as a background daemon
    echo "🔧 Starting daemon..."
    proot-distro login $ALPINE_DIST -- sh -c "
      cd /root
      ( node $SERVER_SCRIPT > $LOG_FILE 2>&1 </dev/null & )
      sleep 1
      if [ -f $PID_FILE ]; then
        PID=\$(cat $PID_FILE)
        if ps | grep -q \"^\s*\$PID\s\"; then
          exit 0
        fi
      fi
      # Get the actual PID of the node process
      PID=\$(ps | grep 'node.*browser-server' | grep -v grep | awk '{print \$1}' | head -1)
      if [ -n \"\$PID\" ]; then
        echo \$PID > $PID_FILE
        exit 0
      else
        exit 1
      fi
    "

    # Wait a moment and check if it started
    sleep 1

    if proot-distro login $ALPINE_DIST -- test -f $PID_FILE; then
      PID=$(proot-distro login $ALPINE_DIST -- cat $PID_FILE)
      if proot-distro login $ALPINE_DIST -- sh -c "ps | grep -q '^\s*$PID\s'"; then
        echo "✅ Browser server started successfully (PID: $PID)"
        echo "📊 Check status: ./daemon-manager.sh status"
        echo "📋 View logs: ./daemon-manager.sh logs"
      else
        echo "❌ Failed to start browser server"
        echo "📋 Check logs: ./daemon-manager.sh logs"
        exit 1
      fi
    else
      echo "❌ PID file not created, startup failed"
      exit 1
    fi
    ;;

  stop)
    echo "🛑 Stopping browser server..."

    if ! proot-distro login $ALPINE_DIST -- test -f $PID_FILE; then
      echo "❌ Browser server is not running (no PID file)"
      exit 1
    fi

    PID=$(proot-distro login $ALPINE_DIST -- cat $PID_FILE)

    if proot-distro login $ALPINE_DIST -- sh -c "ps | grep -q '^\s*$PID\s'"; then
      proot-distro login $ALPINE_DIST -- kill $PID
      sleep 2

      # Force kill if still running
      if proot-distro login $ALPINE_DIST -- sh -c "ps | grep -q '^\s*$PID\s'"; then
        echo "⚠️  Process still running, force killing..."
        proot-distro login $ALPINE_DIST -- kill -9 $PID
      fi

      proot-distro login $ALPINE_DIST -- rm -f $PID_FILE
      echo "✅ Browser server stopped"
    else
      echo "⚠️  Process not running, cleaning up PID file..."
      proot-distro login $ALPINE_DIST -- rm -f $PID_FILE
    fi
    ;;

  restart)
    echo "🔄 Restarting browser server..."
    $0 stop
    sleep 1
    $0 start
    ;;

  status)
    echo "📊 Browser Server Status:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if proot-distro login $ALPINE_DIST -- test -f $PID_FILE; then
      PID=$(proot-distro login $ALPINE_DIST -- cat $PID_FILE)

      if proot-distro login $ALPINE_DIST -- sh -c "ps | grep -q '^\s*$PID\s'"; then
        echo "Status: ✅ Running"
        echo "PID: $PID"

        # Try to get health check from the server
        if command -v curl > /dev/null 2>&1; then
          echo ""
          echo "Health Check:"
          proot-distro login $ALPINE_DIST -- curl -s http://127.0.0.1:3000/health 2>/dev/null | cat || echo "  (HTTP server not responding)"
        fi
      else
        echo "Status: ❌ Not Running (stale PID file)"
        echo "PID File: $PID (process not found)"
      fi
    else
      echo "Status: ❌ Not Running"
      echo "PID File: Not found"
    fi
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    ;;

  logs)
    echo "📋 Browser Server Logs (last 50 lines):"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if proot-distro login $ALPINE_DIST -- test -f $LOG_FILE; then
      proot-distro login $ALPINE_DIST -- tail -n 50 $LOG_FILE
    else
      echo "❌ Log file not found"
    fi
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    ;;

  logs-live)
    echo "📋 Browser Server Logs (live - Ctrl+C to exit):"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if proot-distro login $ALPINE_DIST -- test -f $LOG_FILE; then
      proot-distro login $ALPINE_DIST -- tail -f $LOG_FILE
    else
      echo "❌ Log file not found"
    fi
    ;;

  test)
    echo "🧪 Testing browser server connection..."

    if ! proot-distro login $ALPINE_DIST -- test -f $PID_FILE; then
      echo "❌ Browser server is not running"
      exit 1
    fi

    echo "Testing HTTP health endpoint..."
    RESPONSE=$(proot-distro login $ALPINE_DIST -- sh -c "curl -s http://127.0.0.1:3000/health" 2>/dev/null)

    if [ -n "$RESPONSE" ]; then
      echo "✅ Server responded:"
      echo "$RESPONSE"
    else
      echo "❌ No response from server"
      exit 1
    fi
    ;;

  *)
    echo "Browser Server Daemon Manager"
    echo ""
    echo "Usage: $0 {start|stop|restart|status|logs|logs-live|test}"
    echo ""
    echo "Commands:"
    echo "  start      - Start the browser server daemon in Alpine"
    echo "  stop       - Stop the browser server daemon"
    echo "  restart    - Restart the browser server daemon"
    echo "  status     - Check if the daemon is running"
    echo "  logs       - View the last 50 lines of logs"
    echo "  logs-live  - Tail logs in real-time"
    echo "  test       - Test HTTP connection to the server"
    exit 1
    ;;
esac
