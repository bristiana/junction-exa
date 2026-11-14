"""Finnish public holidays, Gregorian calendar; no network or opening-hour claims.

Christmas Eve and Midsummer Eve are included separately as customary closure days.
"""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo


def easter_sunday(year):
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    n = h + l - 7 * m + 114
    return date(year, n // 31, n % 31 + 1)


def saturday_on_or_after(day):
    return day + timedelta(days=(5 - day.weekday()) % 7)


def public_holidays(year):
    """Named public holidays; ordinary Sundays are not enumerated."""
    if not 1583 <= year <= 9999:
        raise ValueError('Year must be between 1583 and 9999')
    easter = easter_sunday(year)
    midsummer = saturday_on_or_after(date(year, 6, 20))
    days = [(date(year, 1, 1), "New Year's Day"), (date(year, 1, 6), 'Epiphany'),
            (easter - timedelta(days=2), 'Good Friday'), (easter, 'Easter Sunday'),
            (easter + timedelta(days=1), 'Easter Monday'), (date(year, 5, 1), 'May Day'),
            (easter + timedelta(days=39), 'Ascension Day'), (easter + timedelta(days=49), 'Whit Sunday'),
            (midsummer, 'Midsummer Day'), (saturday_on_or_after(date(year, 10, 31)), "All Saints’ Day"),
            (date(year, 12, 6), 'Independence Day'), (date(year, 12, 25), 'Christmas Day'),
            (date(year, 12, 26), "St Stephen’s Day")]
    return {'year': year, 'holidays': [{'date': d.isoformat(), 'name': name} for d, name in sorted(days)],
            'customary_closure_days': [{'date': (midsummer - timedelta(days=1)).isoformat(), 'name': 'Midsummer Eve'},
                                      {'date': date(year, 12, 24).isoformat(), 'name': 'Christmas Eve'}]}


def today_holiday_status():
    """Holiday closure guidance for today's date in Finland, not verified hours."""
    today = datetime.now(ZoneInfo('Europe/Helsinki')).date()
    calendar = public_holidays(today.year)
    holiday = next((day['name'] for day in calendar['holidays'] if day['date'] == today.isoformat()), None)
    return {'is_public_holiday': holiday is not None, 'public_holiday': holiday,
            'holiday_date': today.isoformat(),
            'holiday_notice': 'Public holiday: offices are generally closed; check the office opening hours.' if holiday else None}
