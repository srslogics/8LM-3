class AppError(Exception):
    """An actionable message safe to return to the browser."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


class GoogleError(AppError):
    def __init__(self, message: str, status: int = 400, uncertain: bool = False):
        super().__init__(message, status)
        self.uncertain = uncertain
