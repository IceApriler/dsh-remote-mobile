/**
 * 时间与倒计时工具函数 (支持中英文国际化)
 */

export function formatTime(ts, lang) {
  if (!ts) return lang === 'en' ? 'Unknown' : '未知时间';
  var date = new Date(ts);
  var now = new Date();
  var isToday = date.toDateString() === now.toDateString();

  var pad = function(n) { return n < 10 ? '0' + n : n; };
  var timeStr = pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());

  if (isToday) {
    return (lang === 'en' ? 'Today ' : '今天 ') + timeStr;
  }
  if (lang === 'en') {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[date.getMonth()] + ' ' + date.getDate() + ' ' + timeStr;
  }
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + timeStr;
}

export function formatCountdown(sec, lang) {
  if (sec <= 0) return lang === 'en' ? 'Expired' : '已过期';
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  if (lang === 'en') {
    return (m > 0 ? m + 'm ' : '') + (s < 10 ? '0' + s : s) + 's';
  }
  return (m > 0 ? m + ' 分 ' : '') + (s < 10 ? '0' + s : s) + ' 秒';
}
